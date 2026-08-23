import { Inject, Injectable } from '@nestjs/common';
import { parseEther } from 'ethers';
import {
  TransferKind,
  isAddress as isAddressShared,
  type TransferJobView,
} from '@mintbot/shared';
import { TOKENS } from '../../domain/tokens';
import type { TransferJobRepository } from '../../domain/repositories/transfer.repository';
import type { WalletRepository } from '../../domain/repositories/wallet.repository';
import type { ChainRepository } from '../../domain/repositories/system.repository';
import type { MintSchedulerPort } from '../../domain/ports/ports';
import type { TransferJobEntity } from '../../domain/entities/transfer.entity';
import { NotFoundError, ValidationError } from '../common/app-error';

export interface CreateFundTransferInput {
  chainKey: string;
  fromWalletId: string;
  toWalletIds: string[];
  amountEth: string; // decimal ETH, same amount to every destination
}

export interface CreateTransferNftInput {
  chainKey: string;
  fromWalletIds: string[]; // wallets holding the NFTs
  recipientAddress: string;
  tokenContract: string;
  fromBlock?: number | null;
}

@Injectable()
export class CreateTransferUseCase {
  constructor(
    @Inject(TOKENS.TransferJobRepository) private readonly transfers: TransferJobRepository,
    @Inject(TOKENS.WalletRepository) private readonly wallets: WalletRepository,
    @Inject(TOKENS.ChainRepository) private readonly chains: ChainRepository,
    @Inject(TOKENS.MintScheduler) private readonly scheduler: MintSchedulerPort,
  ) {}

  private async assertChain(chainKey: string) {
    const chain = await this.chains.findByKey(chainKey);
    if (!chain) throw new NotFoundError('Chain');
    if (!chain.isActive) throw new ValidationError('Chain is disabled');
    return chain;
  }

  private async assertOwnWallets(userId: string, ids: string[]) {
    const unique = [...new Set(ids)];
    if (unique.length === 0) throw new ValidationError('Select at least one wallet');
    const rows = await Promise.all(unique.map((id) => this.wallets.findById(id)));
    const owned = rows.filter((w): w is NonNullable<typeof w> => w !== null && w.userId === userId);
    if (owned.length !== unique.length) throw new NotFoundError('One or more wallets');
    return owned;
  }

  /** Fund: send `amountEth` from the main wallet to every destination wallet. */
  async executeFund(userId: string, input: CreateFundTransferInput): Promise<TransferJobView> {
    await this.assertChain(input.chainKey);
    if (input.fromWalletId && input.toWalletIds.includes(input.fromWalletId)) {
      throw new ValidationError('Source wallet cannot also be a destination');
    }
    const source = await this.assertOwnWallets(userId, [input.fromWalletId]);
    const destinations = await this.assertOwnWallets(userId, input.toWalletIds);

    let amountWei: bigint;
    try {
      amountWei = parseEther(input.amountEth.trim());
    } catch {
      throw new ValidationError('Invalid ETH amount');
    }
    if (amountWei <= 0n) throw new ValidationError('Amount must be positive');

    const job = await this.transfers.create({
      userId,
      kind: TransferKind.Fund,
      chainKey: input.chainKey,
      fromWalletId: source[0].id,
      toWalletIds: destinations.map((w) => w.id),
      amountEth: input.amountEth.trim(),
    });
    await this.scheduler.scheduleTransfer(job.id);
    return toViewInternal(job, source[0].address);
  }

  /** Transfer NFTs: move NFTs held by the source wallets to one recipient. */
  async executeTransferNft(userId: string, input: CreateTransferNftInput): Promise<TransferJobView> {
    await this.assertChain(input.chainKey);
    if (!isAddressShared(input.recipientAddress)) throw new ValidationError('Invalid recipient address');
    if (!isAddressShared(input.tokenContract)) throw new ValidationError('Invalid token contract address');
    const sources = await this.assertOwnWallets(userId, input.fromWalletIds);

    const job = await this.transfers.create({
      userId,
      kind: TransferKind.TransferNft,
      chainKey: input.chainKey,
      toWalletIds: sources.map((w) => w.id),
      recipientAddress: input.recipientAddress.toLowerCase(),
      tokenContract: input.tokenContract.toLowerCase(),
      fromBlock: input.fromBlock ?? null,
    });
    await this.scheduler.scheduleTransfer(job.id);
    return toViewInternal(job, null);
  }
}

@Injectable()
export class ListTransfersUseCase {
  constructor(
    @Inject(TOKENS.TransferJobRepository) private readonly transfers: TransferJobRepository,
    @Inject(TOKENS.WalletRepository) private readonly wallets: WalletRepository,
  ) {}

  async execute(userId: string, page: number, limit: number) {
    const paged = await this.transfers.listByUser(userId, page, limit);
    const walletIds = [
      ...new Set(paged.data.flatMap((j) => [j.fromWalletId, ...j.toWalletIds]).filter((x): x is string => Boolean(x))),
    ];
    const rows = await Promise.all(walletIds.map((id) => this.wallets.findById(id)));
    const byId = new Map(rows.filter((r): r is NonNullable<typeof r> => r !== null).map((r) => [r.id, r.address]));

    return {
      data: paged.data.map((j) => toViewInternal(j, byId)),
      meta: { page, limit, total: paged.total, totalPages: paged.totalPages },
    };
  }

  private toView = toViewInternal;
}

function toViewInternal(
  job: TransferJobEntity,
  walletLookup: string | Map<string, string> | null,
): TransferJobView {
  const resolve = (id: string | null): string | null => {
    if (!id || walletLookup === null) return null;
    if (typeof walletLookup === 'string') return walletLookup;
    return walletLookup.get(id) ?? null;
  };

  return {
    id: job.id,
    kind: job.kind as TransferJobView['kind'],
    chainKey: job.chainKey,
    fromWalletAddress: resolve(job.fromWalletId),
    recipientAddress: job.recipientAddress,
    targetCount: job.toWalletIds.length,
    amountEth: job.amountEth,
    tokenContract: job.tokenContract,
    status: job.status as TransferJobView['status'],
    results: job.results ?? [],
    error: job.error,
    createdAt: job.createdAt.toISOString(),
    completedAt: job.completedAt?.toISOString() ?? null,
  };
}
