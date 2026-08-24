import { Inject, Injectable } from '@nestjs/common';
import {
  ENGINE_DEFAULTS,
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
import { ResolveCollectionUseCase } from '../eligibility/resolve-collection.use-case';
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
    private readonly resolveCollection: ResolveCollectionUseCase,
  ) {}

  async execute(userId: string, input: CreateTaskInput): Promise<TaskView> {
    // ── Collection Auto-resolution ──
    const parsed = parseCollectionInput(input.collection);
    const targetChain = parsed.chainKey || input.chainKey;
    let resolvedSlug = parsed.slug;
    let resolvedAddress = parsed.address;

    if (!resolvedSlug && resolvedAddress) {
      try {
        const resolved = await this.resolveCollection.execute(resolvedAddress, targetChain);
        if (resolved.slug) resolvedSlug = resolved.slug;
      } catch {}
    } else if (!resolvedAddress && resolvedSlug) {
      try {
        const resolved = await this.resolveCollection.execute(resolvedSlug, targetChain);
        if (resolved.contractAddress) resolvedAddress = resolved.contractAddress;
      } catch {}
    }

    if (!resolvedAddress && !resolvedSlug) throw new ValidationError('Invalid collection address or URL');

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

    // ── Gas (optional → engine defaults) ──
    const maxFeeGwei = input.maxFeeGwei ?? ENGINE_DEFAULTS.defaultMaxFeeGwei;
    const maxPriorityGwei = input.maxPriorityGwei ?? ENGINE_DEFAULTS.defaultPriorityGwei;
    if (maxFeeGwei <= 0 || maxPriorityGwei < 0) {
      throw new ValidationError('Gas values must be positive');
    }
    if (maxPriorityGwei >= maxFeeGwei) {
      throw new ValidationError('Priority tip must be below the fee ceiling');
    }
    const gasLimit = input.gasLimit ?? ENGINE_DEFAULTS.defaultGasLimit;
    if (gasLimit < MIN_GAS_LIMIT || gasLimit > MAX_GAS_LIMIT) {
      throw new ValidationError(`Gas limit must be between ${MIN_GAS_LIMIT} and ${MAX_GAS_LIMIT}`);
    }

    // ── Recipient ──
    if (input.recipientAddress && !isAddress(input.recipientAddress)) {
      throw new ValidationError('Invalid recipient address');
    }
    if (input.mintMode === MintMode.Allowlist || input.mintMode === MintMode.Fcfs) {
      if (!resolvedSlug && !resolvedAddress) {
        throw new ValidationError(
          'Allowlist/FCFS modes need a valid OpenSea collection slug or contract address',
        );
      }
    }

    // ── Timing ──
    let resolvedFireAt: Date | null = null;
    let timingMode = input.timingMode;
    let customFireTime = input.customFireTime ?? null;

    if (input.fireTimestamp != null && input.fireTimestamp > 0) {
      const t = input.fireTimestamp * 1000;
      if (t < Date.now() + 10_000) {
        throw new ValidationError('Timestamp must be at least 10 seconds in the future');
      }
      resolvedFireAt = new Date(t);
      timingMode = TimingMode.CustomTime;
      customFireTime = new Date(t).toISOString();
    } else if (timingMode === TimingMode.FireNow) {
      resolvedFireAt = new Date(Date.now() + 2_000);
    } else if (timingMode === TimingMode.CustomTime) {
      if (!customFireTime) throw new ValidationError('customFireTime is required');
      const t = new Date(customFireTime).getTime();
      if (Number.isNaN(t)) throw new ValidationError('Invalid customFireTime');
      if (t < Date.now() + 10_000) {
        throw new ValidationError('Custom fire time must be at least 10 seconds in the future');
      }
      resolvedFireAt = new Date(t);
    }

    const delayMs = input.delayMs ?? 1000;
    const finalCollection = (input.mintMode === MintMode.Allowlist || input.mintMode === MintMode.Fcfs)
      ? (resolvedSlug || resolvedAddress!)
      : (resolvedAddress || resolvedSlug!);
    const name = input.name.trim() || resolvedSlug || resolvedAddress || 'Mint Task';

    const task = await this.tasks.create({
      userId,
      name,
      collection: finalCollection,
      chainKey: targetChain,
      walletIds,
      quantity: input.quantity,
      mintMode: input.mintMode,
      walletMode: input.walletMode,
      maxFeeGwei,
      maxPriorityGwei,
      gasLimit,
      rpcUrls: dedupeUrls(input.rpcUrls ?? [], chain.publicRpcs),
      timingMode,
      customFireTime: customFireTime ? new Date(customFireTime) : null,
      recipientAddress: input.recipientAddress?.toLowerCase() ?? null,
      sponsorWalletId: input.sponsorWalletId ?? null,
      pricePerNft: input.pricePerNft ?? null,
      proxyGroup: input.proxyGroup ?? null,
      fundedOnly: input.fundedOnly ?? false,
      flashbots: input.flashbots ?? false,
      nonce: input.nonce ?? null,
      fireTimestamp: input.fireTimestamp ?? null,
      delayMs,
      simulate: input.simulate ?? false,
      spam: input.spam ?? false,
      action: input.action ?? false,
      status: TaskStatus.Scheduled,
      resolvedFireAt,
    });

    // "Action" = manual trigger: persist the task but do not auto-schedule.
    if (input.action) {
      await this.notifier.notifyUser(
        userId,
        `Task "${name}" created (manual trigger) — run it when ready.`,
      );
      return toTaskView(task);
    }

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
      `Task "${name}" created and scheduled on ${chain.name}.`,
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
    sponsorWalletId: task.sponsorWalletId,
    pricePerNft: task.pricePerNft,
    proxyGroup: task.proxyGroup,
    fundedOnly: task.fundedOnly,
    flashbots: task.flashbots,
    nonce: task.nonce,
    fireTimestamp: task.fireTimestamp,
    delayMs: task.delayMs,
    simulate: task.simulate,
    spam: task.spam,
    action: task.action,
    status: task.status,
    createdAt: task.createdAt.toISOString(),
    startedAt: task.startedAt?.toISOString() ?? null,
    completedAt: task.completedAt?.toISOString() ?? null,
    walletCount: task.walletIds.length,
  };
}
