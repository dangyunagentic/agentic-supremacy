import { Inject, Injectable } from '@nestjs/common';
import {
  MAX_WALLETS_PER_TASK,
  MintMode,
  PRE_FLIGHT_LEAD_MS,
  TaskStatus,
  TimingMode,
  WalletMode,
  isAddress,
  parseCollectionInput,
  type CreateTaskInput,
  type TaskView,
} from '@mintbot/shared';
import { TOKENS } from '../../domain/tokens';
import type { TaskRepository } from '../../domain/repositories/task.repository';
import type { WalletRepository } from '../../domain/repositories/wallet.repository';
import type { ChainRepository } from '../../domain/repositories/system.repository';
import type { MintSchedulerPort, NotifierPort } from '../../domain/ports/ports';
import type { TaskEntity } from '../../domain/entities/task.entity';
import { ValidationError, NotFoundError } from '../common/app-error';

const MIN_GAS_LIMIT = 21_000;
const MAX_GAS_LIMIT = 2_000_000;

@Injectable()
export class CreateTaskUseCase {
  constructor(
    @Inject(TOKENS.TaskRepository) private readonly tasks: TaskRepository,
    @Inject(TOKENS.WalletRepository) private readonly wallets: WalletRepository,
    @Inject(TOKENS.ChainRepository) private readonly chains: ChainRepository,
    @Inject(TOKENS.MintScheduler) private readonly scheduler: MintSchedulerPort,
    @Inject(TOKENS.Notifier) private readonly notifier: NotifierPort,
  ) {}

  async execute(userId: string, input: CreateTaskInput): Promise<TaskView> {
    // ── Collection ──
    const parsed = parseCollectionInput(input.collection);
    if (!parsed.address && !parsed.slug) throw new ValidationError('Invalid collection');

    // ── Chain ──
    const chain = await this.chains.findByKey(input.chainKey);
    if (!chain) throw new NotFoundError('Chain');
    if (!chain.isActive) throw new ValidationError('Chain is disabled');

    // ── Wallets ──
    const walletIds = [...new Set(input.walletIds)];
    if (walletIds.length === 0) throw new ValidationError('Select at least one wallet');

    const walletLimit = MAX_WALLETS_PER_TASK[input.walletMode] ?? 1;
    if (walletIds.length > walletLimit) {
      throw new ValidationError(
        `Mode "${input.walletMode}" allows at most ${walletLimit} wallet(s) per task`,
      );
    }

    const wallets = await Promise.all(walletIds.map((id) => this.wallets.findById(id)));
    const found = wallets.filter((w): w is NonNullable<typeof w> => w !== null);
    if (found.length !== walletIds.length) throw new NotFoundError('One or more wallets');
    for (const w of found) {
      if (w.userId !== userId) throw new NotFoundError('One or more wallets');
    }

    // Sponsored (EIP-7702) mode is experimental; see PRD open question Q4.
    if (input.walletMode === WalletMode.Sponsored) {
      throw new ValidationError(
        'Sponsored (EIP-7702) mode is experimental and not enabled on this deployment',
      );
    }
    if (input.walletMode === WalletMode.Single && walletIds.length > 1) {
      throw new ValidationError('Single-wallet mode allows exactly one wallet');
    }

    // ── Quantity ──
    if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 50) {
      throw new ValidationError('Quantity must be between 1 and 50 per wallet');
    }

    // ── Gas ──
    if (input.maxFeeGwei <= 0 || input.maxPriorityGwei < 0) {
      throw new ValidationError('Gas values must be positive');
    }
    if (input.maxPriorityGwei >= input.maxFeeGwei) {
      throw new ValidationError('Priority tip must be below the fee ceiling');
    }
    const gasLimit = input.gasLimit ?? 250_000;
    if (gasLimit < MIN_GAS_LIMIT || gasLimit > MAX_GAS_LIMIT) {
      throw new ValidationError(`Gas limit must be between ${MIN_GAS_LIMIT} and ${MAX_GAS_LIMIT}`);
    }

    // ── Recipient ──
    if (input.recipientAddress && !isAddress(input.recipientAddress)) {
      throw new ValidationError('Invalid recipient address');
    }
    if (input.mintMode === MintMode.Allowlist || input.mintMode === MintMode.Fcfs) {
      if (!parsed.slug) {
        throw new ValidationError(
          'Allowlist/FCFS modes need an OpenSea collection slug or URL (the OpenSea API is slug-based)',
        );
      }
    }

    // ── Timing ──
    let resolvedFireAt: Date | null = null;
    if (input.timingMode === TimingMode.FireNow) {
      resolvedFireAt = new Date(Date.now() + 2_000);
    } else if (input.timingMode === TimingMode.CustomTime) {
      if (!input.customFireTime) throw new ValidationError('customFireTime is required');
      const t = new Date(input.customFireTime).getTime();
      if (Number.isNaN(t)) throw new ValidationError('Invalid customFireTime');
      if (t < Date.now() + 10_000) {
        throw new ValidationError('Custom fire time must be at least 10 seconds in the future');
      }
      resolvedFireAt = new Date(t);
    }

    const task = await this.tasks.create({
      userId,
      name: input.name.trim(),
      collection: parsed.address ?? parsed.slug!,
      chainKey: input.chainKey,
      walletIds,
      quantity: input.quantity,
      mintMode: input.mintMode,
      walletMode: input.walletMode,
      maxFeeGwei: input.maxFeeGwei,
      maxPriorityGwei: input.maxPriorityGwei,
      gasLimit,
      rpcUrls: dedupeUrls(input.rpcUrls ?? [], chain.publicRpcs),
      timingMode: input.timingMode,
      customFireTime: input.customFireTime ? new Date(input.customFireTime) : null,
      recipientAddress: input.recipientAddress?.toLowerCase() ?? null,
      sponsorWalletId: input.sponsorWalletId ?? null,
      status: TaskStatus.Scheduled,
      resolvedFireAt,
    });

    // Preflight runs at T-60s when the fire time is already known, otherwise
    // immediately so the worker can resolve the on-chain stage start.
    if (resolvedFireAt) {
      const preflightAt = new Date(
        Math.max(Date.now(), resolvedFireAt.getTime() - PRE_FLIGHT_LEAD_MS),
      );
      await this.scheduler.schedulePreflight(task.id, preflightAt);
    } else {
      await this.scheduler.runNow(task.id);
    }

    await this.notifier.notifyUser(
      userId,
      `Task "${task.name}" created and scheduled on ${chain.name}.`,
    );

    return toTaskView(task);
  }
}

export function dedupeUrls(custom: string[], fallback: string[]): string[] {
  const urls = custom
    .map((u) => u.trim())
    .filter((u) => /^https?:\/\//.test(u))
    .map((u) => u.replace(/\/+$/, ''));
  return urls.length > 0 ? [...new Set(urls)] : fallback;
}

export function toTaskView(task: TaskEntity): TaskView {
  return {
    id: task.id,
    userId: task.userId,
    name: task.name,
    collection: task.collection,
    chainKey: task.chainKey,
    walletIds: task.walletIds,
    quantity: task.quantity,
    mintMode: task.mintMode,
    walletMode: task.walletMode,
    maxFeeGwei: task.maxFeeGwei,
    maxPriorityGwei: task.maxPriorityGwei,
    gasLimit: task.gasLimit,
    rpcUrls: task.rpcUrls,
    timingMode: task.timingMode,
    customFireTime: task.customFireTime?.toISOString() ?? null,
    resolvedFireAt: task.resolvedFireAt?.toISOString() ?? null,
    recipientAddress: task.recipientAddress,
    status: task.status,
    createdAt: task.createdAt.toISOString(),
    startedAt: task.startedAt?.toISOString() ?? null,
    completedAt: task.completedAt?.toISOString() ?? null,
    walletCount: task.walletIds.length,
  };
}
