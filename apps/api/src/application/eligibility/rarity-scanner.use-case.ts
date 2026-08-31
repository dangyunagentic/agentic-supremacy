import { Inject, Injectable, Logger } from '@nestjs/common';
import { parseCollectionInput, getChainProfile } from '@mintbot/shared';
import { TOKENS } from '../../domain/tokens';
import type { ChainRepository, SystemConfigRepository } from '../../domain/repositories/system.repository';
import type { KeyEncryptionPort } from '../../domain/ports/ports';

export interface TraitEntry {
  traitType: string;
  value: string;
  /** rarity = 1/frequency — higher = rarer */
  rarityScore: number;
  /** how many tokens share this exact trait value */
  occurrence: number;
}

export interface TokenRarity {
  tokenId: string;
  rarityScore: number;
  rank: number;
  traits: TraitEntry[];
  imageUrl: string | null;
  name: string | null;
}

export interface RarityReport {
  collection: string;
  slug: string | null;
  contractAddress: string | null;
  chainKey: string;
  totalScanned: number;
  tokens: TokenRarity[];
  traitFrequency: Record<string, Record<string, number>>;
  scannedAt: string;
  source: 'opensea' | 'onchain' | 'unknown';
}

@Injectable()
export class RarityScannerUseCase {
  private readonly logger = new Logger(RarityScannerUseCase.name);

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

  private openseaChainKey(chainKey: string): string {
    const map: Record<string, string> = {
      ethereum: 'ethereum', mainnet: 'ethereum', eth: 'ethereum',
      base: 'base', polygon: 'matic', matic: 'matic',
      optimism: 'optimism', op: 'optimism', arbitrum: 'arbitrum', arb: 'arbitrum',
      avalanche: 'avalanche', avax: 'avalanche', blast: 'blast', zora: 'zora',
      sei: 'sei', linea: 'linea', berachain: 'berachain', boba: 'boba', scroll: 'scroll',
      robinhood: 'robinhood',
    };
    return map[chainKey] || chainKey;
  }

  /** Fetch NFTs with metadata from OpenSea v2 API (paginated). */
  private async fetchNfts(
    chainKey: string,
    contractAddress: string,
    limit = 200,
    cursor: string | null = null,
  ): Promise<{ nfts: any[]; next: string | null }> {
    const osChain = this.openseaChainKey(chainKey);
    const apiKey = await this.getOpenSeaApiKey();
    const headers: Record<string, string> = {
      accept: 'application/json',
      'user-agent': 'MintBot/1.0',
    };
    if (apiKey) headers['x-api-key'] = apiKey;

    let url = `https://api.opensea.io/api/v2/chain/${osChain}/contract/${contractAddress}/nfts?limit=${limit}`;
    if (cursor) url += `&next=${encodeURIComponent(cursor)}`;

    const res = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        throw new Error('OpenSea API requires an API key for contract NFT listing');
      }
      throw new Error(`OpenSea NFT fetch failed: HTTP ${res.status}`);
    }
    const data = (await res.json()) as any;
    return { nfts: data.nfts ?? [], next: data.next ?? null };
  }

  async execute(
    input: string,
    fallbackChainKey?: string,
    maxScan = 500,
  ): Promise<RarityReport> {
    const parsed = parseCollectionInput(input);
    const targetChain = parsed.chainKey || fallbackChainKey || 'ethereum';

    // Resolve slug -> contract address via OpenSea collections API
    let contractAddress = parsed.address ?? null;
    let slug = parsed.slug ?? null;

    if (!contractAddress && slug) {
      const apiKey = await this.getOpenSeaApiKey();
      const headers: Record<string, string> = {
        accept: 'application/json',
        'user-agent': 'MintBot/1.0',
      };
      if (apiKey) headers['x-api-key'] = apiKey;
      const res = await fetch(`https://api.opensea.io/api/v2/collections/${slug}`, {
        headers,
        signal: AbortSignal.timeout(8_000),
      });
      if (res.ok) {
        const data = (await res.json()) as any;
        const contract = data.contracts?.[0];
        if (contract) {
          contractAddress = contract.address;
          if (contract.chain) {
            // Keep target chain from the contract if it differs
          }
        }
      }
    }

    if (!contractAddress) {
      throw new Error('Could not resolve contract address — pass an OpenSea link, slug, or 0x address');
    }

    const chainRow = await this.chains.findByKey(targetChain);
    const profile = getChainProfile(targetChain);

    // ── Scan NFTs ──
    // Prefer on-chain tokenURI scan (always returns traits), fall back to
    // OpenSea API (which may omit attributes without an API key).
    const allNfts: any[] = [];
    let source: 'opensea' | 'onchain' | 'unknown' = 'unknown';

    const rpcUrl = chainRow?.publicRpcs?.[0] ?? profile?.rpc.public?.[0];
    if (rpcUrl && contractAddress) {
      try {
        const { ethers } = await import('ethers');
        const provider = new ethers.JsonRpcProvider(rpcUrl);
        const abi = [
          'function totalSupply() view returns (uint256)',
          'function tokenURI(uint256) view returns (string)',
          'function maxSupply() view returns (uint256)',
        ];
        const contract = new ethers.Contract(contractAddress, abi, provider);
        let total = 0;
        try {
          total = Number(await contract.totalSupply());
        } catch {
          total = Number(await contract.maxSupply());
        }
        const scanCount = Math.min(total > 0 ? total : maxScan, maxScan);
        for (let id = 0; id < scanCount; id++) {
          try {
            const uri = await contract.tokenURI(id);
            const json = await this.fetchMetadataJson(uri);
            if (json?.attributes) {
              allNfts.push({ identifier: String(id), metadata: json, image_url: json.image ?? null, name: json.name ?? null });
            }
          } catch {
            // skip hidden/unrevealed tokens
          }
        }
        void provider.destroy();
        source = 'onchain';
      } catch (err) {
        this.logger.warn(`On-chain tokenURI scan failed: ${(err as Error).message}`);
      }
    }

    // Fallback: OpenSea API paginated scan
    if (allNfts.length === 0) {
      let cursor: string | null = null;
      try {
        for (let i = 0; i < 20; i++) {
          const page = await this.fetchNfts(targetChain, contractAddress, 200, cursor);
          allNfts.push(...page.nfts);
          source = 'opensea';
          if (allNfts.length >= maxScan) break;
          if (!page.next) break;
          cursor = page.next;
        }
      } catch (err) {
        this.logger.warn(`OpenSea scan failed (${(err as Error).message})`);
      }
    }

    if (allNfts.length === 0) {
      throw new Error('No NFT metadata could be scanned — collection may be pre-reveal (blind box)');
    }

    // ── Parse traits + frequency ──
    const traitFrequency: Record<string, Record<string, number>> = {};
    const tokenTraits: Record<string, TraitEntry[]> = {};

    for (const nft of allNfts) {
      const id = String(nft.identifier ?? nft.token_id ?? '');
      const meta = nft.metadata ?? nft;
      const attrs = Array.isArray(meta.attributes) ? meta.attributes : [];
      const entries: TraitEntry[] = [];
      for (const attr of attrs) {
        const t = String(attr.trait_type ?? 'trait');
        const v = String(attr.value);
        if (!traitFrequency[t]) traitFrequency[t] = {};
        traitFrequency[t][v] = (traitFrequency[t][v] ?? 0) + 1;
        entries.push({ traitType: t, value: v, rarityScore: 0, occurrence: 0 });
      }
      tokenTraits[id] = entries;
    }

    // ── Compute rarity scores (1/frequency sum) ──
    const total = allNfts.length;
    const tokens: TokenRarity[] = [];
    for (const nft of allNfts) {
      const id = String(nft.identifier ?? nft.token_id ?? '');
      const entries = tokenTraits[id] ?? [];
      let score = 0;
      const enriched: TraitEntry[] = entries.map((e) => {
        const occ = traitFrequency[e.traitType]?.[e.value] ?? 1;
        const s = occ > 0 ? 1 / occ : 0;
        score += s;
        return { ...e, rarityScore: s, occurrence: occ };
      });
      const meta = nft.metadata ?? nft;
      tokens.push({
        tokenId: id,
        rarityScore: score,
        rank: 0,
        traits: enriched,
        imageUrl: nft.image_url ?? meta.image ?? null,
        name: nft.name ?? meta.name ?? null,
      });
    }

    tokens.sort((a, b) => b.rarityScore - a.rarityScore);
    tokens.forEach((t, i) => (t.rank = i + 1));

    return {
      collection: input,
      slug,
      contractAddress,
      chainKey: targetChain,
      totalScanned: tokens.length,
      tokens,
      traitFrequency,
      scannedAt: new Date().toISOString(),
      source,
    };
  }

  private async fetchMetadataJson(uri: string): Promise<any | null> {
    try {
      if (uri.startsWith('data:application/json')) {
        const b64 = uri.split(',')[1] ?? '';
        const raw = Buffer.from(b64, 'base64').toString('utf8');
        return JSON.parse(raw);
      }
      if (uri.startsWith('ipfs://')) {
        uri = `https://ipfs.io/ipfs/${uri.slice(7)}`;
      }
      if (uri.startsWith('ar://')) {
        uri = `https://arweave.net/${uri.slice(5)}`;
      }
      const res = await fetch(uri, { signal: AbortSignal.timeout(6_000) });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }
}
