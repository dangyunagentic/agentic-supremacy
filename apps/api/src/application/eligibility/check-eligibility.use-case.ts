import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  formatEth,
  parseCollectionInput,
  type EligibilityReport,
  type PublicDropInfo,
} from '@mintbot/shared';
import { TOKENS } from '../../domain/tokens';
import type { WalletRepository } from '../../domain/repositories/wallet.repository';
import type { ChainRepository, SystemConfigRepository } from '../../domain/repositories/system.repository';
import type { ChainQueryPort, EligibilityApiPort, KeyEncryptionPort } from '../../domain/ports/ports';
import { NotFoundError, ValidationError } from '../common/app-error';

export interface CheckEligibilityInput {
  collection: string;
  chainKey: string;
  walletIds: string[];
  quantity: number;
}

const OPENSEA_CHAIN_MAP: Record<string, string> = {
  ethereum: 'ethereum',
  mainnet: 'ethereum',
  eth: 'ethereum',
  base: 'base',
  polygon: 'matic',
  matic: 'matic',
  optimism: 'optimism',
  op: 'optimism',
  arbitrum: 'arbitrum',
  arb: 'arbitrum',
  avalanche: 'avalanche',
  avax: 'avalanche',
  blast: 'blast',
  zora: 'zora',
  sei: 'sei',
  linea: 'linea',
  berachain: 'berachain',
  boba: 'boba',
  scroll: 'scroll',
};

@Injectable()
export class CheckEligibilityUseCase {
  private readonly logger = new Logger(CheckEligibilityUseCase.name);

  constructor(
    @Inject(TOKENS.WalletRepository) private readonly wallets: WalletRepository,
    @Inject(TOKENS.ChainRepository) private readonly chains: ChainRepository,
    @Inject(TOKENS.SystemConfigRepository) private readonly config: SystemConfigRepository,
    @Inject(TOKENS.KeyEncryption) private readonly crypto: KeyEncryptionPort,
    @Inject(TOKENS.ChainQuery) private readonly chainQuery: ChainQueryPort,
    @Inject(TOKENS.EligibilityApi) private readonly eligibilityApi: EligibilityApiPort,
  ) {}

  private async getOpenSeaApiKey(): Promise<string | null> {
    try {
      const cfg = await this.config.get();
      if (!cfg.openseaApiKeyEnc) return null;
      return this.crypto.decrypt(cfg.openseaApiKeyEnc);
    } catch {
      return null;
    }
  }

  private async resolveContractToSlug(chainKey: string, address: string): Promise<string | null> {
    const osChain = OPENSEA_CHAIN_MAP[chainKey] || chainKey;
    const apiKey = await this.getOpenSeaApiKey();
    const headers: Record<string, string> = { accept: 'application/json', 'user-agent': 'MintBot/1.0' };
    if (apiKey) headers['x-api-key'] = apiKey;

    try {
      const res = await fetch(`https://api.opensea.io/api/v2/chain/${osChain}/contract/${address}`, {
        headers,
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const data = (await res.json()) as any;
        return data.collection || null;
      }
    } catch {
      // ignore
    }
    return null;
  }

  private async resolveSlugToContract(slug: string): Promise<string | null> {
    const apiKey = await this.getOpenSeaApiKey();
    const headers: Record<string, string> = { accept: 'application/json', 'user-agent': 'MintBot/1.0' };
    if (apiKey) headers['x-api-key'] = apiKey;

    try {
      const res = await fetch(`https://api.opensea.io/api/v2/collections/${slug}`, {
        headers,
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const data = (await res.json()) as any;
        if (Array.isArray(data.contracts) && data.contracts.length > 0) {
          return data.contracts[0].address || null;
        }
      }
    } catch {
      // ignore
    }
    return null;
  }

  async execute(userId: string, input: CheckEligibilityInput): Promise<EligibilityReport> {
    const parsed = parseCollectionInput(input.collection);
    const targetChain = parsed.chainKey || input.chainKey;
    if (!parsed.address && !parsed.slug) throw new ValidationError('Invalid collection address or URL');

    const chain = await this.chains.findByKey(targetChain);
    if (!chain) throw new NotFoundError('Chain');
    if (!chain.isActive) throw new ValidationError('Chain is disabled');

    const walletIds = [...new Set(input.walletIds)];
    if (walletIds.length === 0) throw new ValidationError('Select at least one wallet');
    const wallets = await Promise.all(walletIds.map((id) => this.wallets.findById(id)));
    const owned = wallets.filter((w): w is NonNullable<typeof w> => w !== null && w.userId === userId);
    if (owned.length !== walletIds.length) throw new NotFoundError('One or more wallets');

    const quantity = input.quantity > 0 ? input.quantity : 1;

    let targetAddress = parsed.address;
    let targetSlug = parsed.slug;

    // 1. If we have contract address, check on-chain public drop first
    if (targetAddress) {
      const drop: PublicDropInfo | null = await this.chainQuery.getPublicDrop(
        targetChain,
        targetAddress,
      );
      if (drop) {
        const overLimit =
          drop.maxTotalMintableByWallet > 0 && quantity > drop.maxTotalMintableByWallet;
        return {
          collection: targetAddress,
          chainKey: targetChain,
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

      // No public drop found on contract: Auto-resolve to OpenSea slug for GTD / FCFS
      if (!targetSlug) {
        targetSlug = await this.resolveContractToSlug(targetChain, targetAddress) || undefined;
      }
    }

    // 2. If we have a slug (or resolved to one), check GTD/FCFS via OpenSea GraphQL/API
    if (targetSlug) {
      try {
        const stage = await this.eligibilityApi.fetchStage(targetSlug, targetChain);
        if (stage.kind !== 'none' && stage.startTime) {
          const results = await Promise.all(
            owned.map(async (w) => {
              const action = await this.eligibilityApi.fetchWalletAction(targetSlug!, targetChain, w.address);
              return { address: w.address, eligible: action.eligible, reason: action.reason };
            }),
          );

          return {
            collection: targetAddress || targetSlug,
            chainKey: targetChain,
            mode: stage.kind === 'fcfs' ? 'fcfs' : 'allowlist',
            stageStart: stage.startTime,
            stageEnd: stage.endTime,
            stageName: stage.name ?? null,
            mintPrice: null,
            maxPerWallet: null,
            wallets: results,
          };
        }
      } catch (err) {
        this.logger.debug(`OpenSea stage check error: ${(err as Error).message}`);
      }

      // If stage not found yet and we had no address, try resolving slug to address and checking public drop
      if (!targetAddress) {
        targetAddress = await this.resolveSlugToContract(targetSlug) || undefined;
        if (targetAddress) {
          const drop = await this.chainQuery.getPublicDrop(targetChain, targetAddress);
          if (drop) {
            const overLimit = drop.maxTotalMintableByWallet > 0 && quantity > drop.maxTotalMintableByWallet;
            return {
              collection: targetAddress,
              chainKey: targetChain,
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
        }
      }
    }

    throw new ValidationError(
      `No active drop or SeaDrop stage found for this collection on ${targetChain}. Verify the contract or slug.`,
    );
  }
}
