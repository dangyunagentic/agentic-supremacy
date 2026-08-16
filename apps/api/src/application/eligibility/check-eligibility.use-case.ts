import { Inject, Injectable } from '@nestjs/common';
import {
  formatEth,
  parseCollectionInput,
  type EligibilityReport,
  type PublicDropInfo,
} from '@mintbot/shared';
import { TOKENS } from '../../domain/tokens';
import type { WalletRepository } from '../../domain/repositories/wallet.repository';
import type { ChainRepository } from '../../domain/repositories/system.repository';
import type { ChainQueryPort, EligibilityApiPort } from '../../domain/ports/ports';
import { NotFoundError, ValidationError } from '../common/app-error';

export interface CheckEligibilityInput {
  collection: string;
  chainKey: string;
  walletIds: string[];
  quantity: number;
}

/**
 * Public stages are unsigned, so every wallet is eligible by construction;
 * GTD (allowlist) and FCFS are signed and must be checked per wallet through
 * the OpenSea API.
 */
@Injectable()
export class CheckEligibilityUseCase {
  constructor(
    @Inject(TOKENS.WalletRepository) private readonly wallets: WalletRepository,
    @Inject(TOKENS.ChainRepository) private readonly chains: ChainRepository,
    @Inject(TOKENS.ChainQuery) private readonly chainQuery: ChainQueryPort,
    @Inject(TOKENS.EligibilityApi) private readonly eligibilityApi: EligibilityApiPort,
  ) {}

  async execute(userId: string, input: CheckEligibilityInput): Promise<EligibilityReport> {
    const parsed = parseCollectionInput(input.collection);
    if (!parsed.address && !parsed.slug) throw new ValidationError('Invalid collection');
    const collection = parsed.address ?? parsed.slug!;

    const chain = await this.chains.findByKey(input.chainKey);
    if (!chain) throw new NotFoundError('Chain');
    if (!chain.isActive) throw new ValidationError('Chain is disabled');

    const walletIds = [...new Set(input.walletIds)];
    if (walletIds.length === 0) throw new ValidationError('Select at least one wallet');
    const wallets = await Promise.all(walletIds.map((id) => this.wallets.findById(id)));
    const owned = wallets.filter((w): w is NonNullable<typeof w> => w !== null && w.userId === userId);
    if (owned.length !== walletIds.length) throw new NotFoundError('One or more wallets');

    const quantity = input.quantity > 0 ? input.quantity : 1;

    // ── Public path: on-chain drop, every wallet eligible ──
    if (parsed.address) {
      const drop: PublicDropInfo | null = await this.chainQuery.getPublicDrop(
        input.chainKey,
        parsed.address,
      );
      if (drop) {
        const overLimit =
          drop.maxTotalMintableByWallet > 0 && quantity > drop.maxTotalMintableByWallet;
        return {
          collection,
          chainKey: input.chainKey,
          mode: 'public',
          stageStart: drop.startTime ? new Date(drop.startTime * 1000).toISOString() : null,
          stageEnd: drop.endTime ? new Date(drop.endTime * 1000).toISOString() : null,
          mintPrice: drop.mintPrice ? formatEth(BigInt(drop.mintPrice)) : null,
          maxPerWallet: drop.maxTotalMintableByWallet || null,
          wallets: owned.map((w) => ({
            address: w.address,
            eligible: !overLimit,
            reason: overLimit
              ? `Quantity ${quantity} exceeds per-wallet limit ${drop.maxTotalMintableByWallet}`
              : 'Public stage: every wallet can mint',
          })),
        };
      }
      throw new ValidationError(
        'No public drop on this contract. For GTD/FCFS pass the OpenSea collection slug or URL.',
      );
    }

    // ── GTD / FCFS path: signed stages, per-wallet check ──
    let stage: Awaited<ReturnType<EligibilityApiPort['fetchStage']>>;
    try {
      stage = await this.eligibilityApi.fetchStage(parsed.slug!, input.chainKey);
    } catch (err) {
      throw new ValidationError(
        `${(err as Error).message}. GTD/FCFS eligibility needs an OpenSea API key set in System config.`,
      );
    }
    if (stage.kind === 'none' || !stage.startTime) {
      throw new ValidationError(`No active GTD/FCFS stage found for ${parsed.slug}`);
    }

    const results = await Promise.all(
      owned.map(async (w) => {
        const action = await this.eligibilityApi.fetchWalletAction(parsed.slug!, input.chainKey, w.address);
        return { address: w.address, eligible: action.eligible, reason: action.reason };
      }),
    );

    return {
      collection,
      chainKey: input.chainKey,
      mode: stage.kind === 'fcfs' ? 'fcfs' : 'allowlist',
      stageStart: stage.startTime,
      stageEnd: stage.endTime,
      mintPrice: null,
      maxPerWallet: null,
      wallets: results,
    };
  }
}
