import { Inject, Injectable, Logger } from '@nestjs/common';
import { Contract, ethers } from 'ethers';
import { parseCollectionInput, getChainProfile } from '@mintbot/shared';
import { TOKENS } from '../../domain/tokens';
import type { ChainRepository, SystemConfigRepository } from '../../domain/repositories/system.repository';
import type { KeyEncryptionPort } from '../../domain/ports/ports';

export interface ResolvedCollectionInfo {
  name: string | null;
  slug: string | null;
  contractAddress: string | null;
  chainKey: string | null;
  symbol: string | null;
  imageUrl: string | null;
  bannerUrl: string | null;
  description: string | null;
  totalSupply: number | null;
  source: 'opensea' | 'onchain' | 'unknown';
  /** Public SeaDrop stage window (unix seconds). Auto-detected on-chain. */
  dropStartTime?: number | null;
  dropEndTime?: number | null;
  /** Public mint price in wei (decimal string). */
  mintPriceWei?: string | null;
}

const ERC721_MINIMAL_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
];

const SEADROP_PUBLIC_ABI = [
  'function getPublicDrop(address nftContract) view returns (tuple(uint80 mintPrice, uint48 startTime, uint48 endTime, uint16 maxTotalMintableByWallet, uint16 feeBps, bool restrictFeeRecipients))',
];

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
export class ResolveCollectionUseCase {
  private readonly logger = new Logger(ResolveCollectionUseCase.name);

  constructor(
    @Inject(TOKENS.ChainRepository) private readonly chains: ChainRepository,
    @Inject(TOKENS.SystemConfigRepository) private readonly config: SystemConfigRepository,
    @Inject(TOKENS.KeyEncryption) private readonly crypto: KeyEncryptionPort,
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

  async execute(input: string, fallbackChainKey?: string): Promise<ResolvedCollectionInfo> {
    // 0. If it's a Scatter.art URL or slug
    if (input.includes('scatter.art')) {
      const slug = input.replace(/https?:\/\/(www\.)?scatter\.art\/(collection\/)?/i, '').replace(/\/.*$/, '').trim();
      try {
        const scatterRes = await fetch(`https://api.scatter.art/v1/collection/${slug}`, {
          headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0' },
          signal: AbortSignal.timeout(5000),
        });
        if (scatterRes.ok) {
          const data = (await scatterRes.json()) as any;
          const col = data.collection || data;
          return {
            name: col.name || slug,
            slug: col.slug || slug,
            contractAddress: col.address || null,
            chainKey: col.chain || fallbackChainKey || 'base',
            symbol: col.symbol || null,
            imageUrl: col.image || col.avatar || null,
            bannerUrl: col.banner || null,
            description: col.description || null,
            totalSupply: col.totalSupply || null,
            source: 'scatter' as any,
          };
        }
      } catch {
        // continue
      }
    }

    const parsed = parseCollectionInput(input);
    const targetChain = parsed.chainKey || fallbackChainKey || 'ethereum';

    // 1. If we have a contract address
    if (parsed.address) {
      const osData = await this.fetchByContract(targetChain, parsed.address);
      if (osData) return osData;

      const onchainData = await this.fetchOnChain(targetChain, parsed.address);
      if (onchainData) return onchainData;

      const dropInfo = await this.fetchDropInfo(targetChain, parsed.address);
      return {
        name: null,
        slug: null,
        contractAddress: parsed.address,
        chainKey: targetChain,
        symbol: null,
        imageUrl: null,
        bannerUrl: null,
        description: null,
        totalSupply: null,
        source: 'unknown',
        dropStartTime: dropInfo?.startTime ?? null,
        dropEndTime: dropInfo?.endTime ?? null,
        mintPriceWei: dropInfo?.mintPrice ?? null,
      };
    }

    // 2. If we have a slug
    if (parsed.slug) {
      const osSlugData = await this.fetchBySlug(parsed.slug, targetChain);
      if (osSlugData) return osSlugData;

      return {
        name: parsed.slug,
        slug: parsed.slug,
        contractAddress: null,
        chainKey: targetChain,
        symbol: null,
        imageUrl: null,
        bannerUrl: null,
        description: null,
        totalSupply: null,
        source: 'unknown',
      };
    }

    return {
      name: null,
      slug: null,
      contractAddress: null,
      chainKey: targetChain,
      symbol: null,
      imageUrl: null,
      bannerUrl: null,
      description: null,
      totalSupply: null,
      source: 'unknown',
    };
  }

  /** Reads SeaDrop public drop start/end/price on-chain (if this is a SeaDrop contract). */
  private async fetchDropInfo(
    chainKey: string,
    address: string,
  ): Promise<{ startTime: number; endTime: number; mintPrice: string } | null> {
    try {
      const chain = await this.chains.findByKey(chainKey);
      if (!chain) return null;
      const rpcUrl = chain.publicRpcs?.[0];
      if (!rpcUrl) return null;

      const seadropAddress = chain.seadropAddress;
      if (!seadropAddress) return null;

      const provider = new ethers.JsonRpcProvider(rpcUrl);
      const seadrop = new Contract(seadropAddress, SEADROP_PUBLIC_ABI, provider);
      const drop = await seadrop.getPublicDrop(address);
      const startTime = Number(drop.startTime);
      const endTime = Number(drop.endTime);
      if (startTime === 0 && endTime === 0) return null;
      void provider.destroy();
      return {
        startTime,
        endTime,
        mintPrice: BigInt(drop.mintPrice).toString(),
      };
    } catch {
      return null;
    }
  }

  private async fetchByContract(chainKey: string, address: string): Promise<ResolvedCollectionInfo | null> {
    const osChain = OPENSEA_CHAIN_MAP[chainKey] || chainKey;
    const apiKey = await this.getOpenSeaApiKey();

    const headers: Record<string, string> = {
      accept: 'application/json',
      'user-agent': 'MintBot/1.0',
    };
    if (apiKey) headers['x-api-key'] = apiKey;

    try {
      const url = `https://api.opensea.io/api/v2/chain/${osChain}/contract/${address}`;
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(6000) });
      if (res.ok) {
        const data = (await res.json()) as any;
        const slug = data.collection;
        let name = data.name || null;
        let imageUrl: string | null = null;
        let bannerUrl: string | null = null;
        let description: string | null = null;
        let totalSupply: number | null = null;

        if (slug) {
          try {
            const colUrl = `https://api.opensea.io/api/v2/collections/${slug}`;
            const colRes = await fetch(colUrl, { headers, signal: AbortSignal.timeout(5000) });
            if (colRes.ok) {
              const colData = (await colRes.json()) as any;
              name = colData.name || name;
              imageUrl = colData.image_url || null;
              bannerUrl = colData.banner_image_url || null;
              description = colData.description || null;
              totalSupply = colData.total_supply ?? null;
            }
          } catch {
            // ignore
          }
        }

        return {
          name: name || address.slice(0, 10),
          slug: slug || null,
          contractAddress: address,
          chainKey,
          symbol: data.symbol || null,
          imageUrl,
          bannerUrl,
          description,
          totalSupply,
          source: 'opensea',
        };
      }
    } catch (err) {
      this.logger.debug(`OpenSea contract lookup error: ${(err as Error).message}`);
    }

    return null;
  }

  private async fetchBySlug(slug: string, chainKey: string): Promise<ResolvedCollectionInfo | null> {
    const apiKey = await this.getOpenSeaApiKey();
    const headers: Record<string, string> = {
      accept: 'application/json',
      'user-agent': 'MintBot/1.0',
    };
    if (apiKey) headers['x-api-key'] = apiKey;

    try {
      const colUrl = `https://api.opensea.io/api/v2/collections/${slug}`;
      const res = await fetch(colUrl, { headers, signal: AbortSignal.timeout(6000) });
      if (res.ok) {
        const colData = (await res.json()) as any;
        let primaryContract: string | null = null;
        let detectedChain: string = chainKey;

        // Try getting contract from contracts array if available
        if (Array.isArray(colData.contracts) && colData.contracts.length > 0) {
          primaryContract = colData.contracts[0].address;
          detectedChain = colData.contracts[0].chain || chainKey;
        }

        return {
          name: colData.name || slug,
          slug,
          contractAddress: primaryContract,
          chainKey: detectedChain,
          symbol: null,
          imageUrl: colData.image_url || null,
          bannerUrl: colData.banner_image_url || null,
          description: colData.description || null,
          totalSupply: colData.total_supply ?? null,
          source: 'opensea',
        };
      }
    } catch (err) {
      this.logger.debug(`OpenSea slug lookup error: ${(err as Error).message}`);
    }

    return null;
  }

  private async fetchOnChain(chainKey: string, address: string): Promise<ResolvedCollectionInfo | null> {
    try {
      const chainRow = await this.chains.findByKey(chainKey);
      const profile = getChainProfile(chainKey);
      const rpcs = chainRow?.publicRpcs?.length ? chainRow.publicRpcs : profile?.rpc?.public ?? [];
      if (!rpcs.length) return null;

      const provider = new ethers.JsonRpcProvider(rpcs[0]);
      const contract = new Contract(address, ERC721_MINIMAL_ABI, provider);

      const [name, symbol] = await Promise.allSettled([
        contract.name(),
        contract.symbol(),
      ]);

      const nameVal = name.status === 'fulfilled' ? name.value : null;
      const symbolVal = symbol.status === 'fulfilled' ? symbol.value : null;

      if (!nameVal && !symbolVal) return null;

      return {
        name: nameVal,
        slug: null,
        contractAddress: address,
        chainKey,
        symbol: symbolVal,
        imageUrl: null,
        bannerUrl: null,
        description: null,
        totalSupply: null,
        source: 'onchain',
      };
    } catch {
      return null;
    }
  }
}
