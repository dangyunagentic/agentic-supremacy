import { Inject, Injectable, Logger } from '@nestjs/common';
import { Contract, ethers } from 'ethers';
import { TOKENS } from '../../domain/tokens';
import type { ChainRepository, SystemConfigRepository } from '../../domain/repositories/system.repository';
import type { KeyEncryptionPort } from '../../domain/ports/ports';
import { getChainProfile, parseCollectionInput } from '@mintbot/shared';

export interface NftContractInfo {
  name: string | null;
  symbol: string | null;
  collectionName: string | null;
  imageUrl: string | null;
  floorPriceEth: string | null;
  chainKey: string;
  contractAddress: string;
  source: 'opensea' | 'onchain' | 'unknown';
}

const ERC721_MINIMAL_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function tokenURI(uint256) view returns (string)',
  'function contractURI() view returns (string)',
  'function uri(uint256) view returns (string)',
];

const IPFS_GATEWAYS = [
  'https://ipfs.io/ipfs/',
  'https://cloudflare-ipfs.com/ipfs/',
  'https://dweb.link/ipfs/',
];

function resolveIpfsUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith('ipfs://')) {
    return url.replace('ipfs://', IPFS_GATEWAYS[0]);
  }
  return url;
}

@Injectable()
export class GetNftInfoUseCase {
  private readonly logger = new Logger(GetNftInfoUseCase.name);

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

  async execute(rawChainKey: string, rawInput: string): Promise<NftContractInfo> {
    const parsed = parseCollectionInput(rawInput || '');
    const cleanChain = (parsed.chainKey || rawChainKey || 'base').trim().toLowerCase();
    const cleanAddress = (parsed.address || rawInput || '').trim();

    // 1. If it's a slug or OpenSea collection link, try OpenSea Collections API v2
    if (parsed.slug && !parsed.address) {
      const slugInfo = await this.fetchFromOpenSeaSlug(parsed.slug, cleanChain);
      if (slugInfo) return slugInfo;
    }

    // 2. Try on-chain RPC resolver
    if (cleanAddress && cleanAddress.startsWith('0x') && cleanAddress.length === 42) {
      const onchainInfo = await this.fetchFromOnChain(cleanChain, cleanAddress);
      if (onchainInfo && (onchainInfo.name || onchainInfo.symbol)) {
        return onchainInfo;
      }

      // 3. Try OpenSea with API key if configured
      const osInfo = await this.fetchFromOpenSeaContract(cleanChain, cleanAddress);
      if (osInfo) return osInfo;
    }

    return {
      name: null,
      symbol: null,
      collectionName: null,
      imageUrl: null,
      floorPriceEth: null,
      chainKey: cleanChain,
      contractAddress: cleanAddress,
      source: 'unknown',
    };
  }

  private async fetchFromOpenSeaSlug(slug: string, chainKey: string): Promise<NftContractInfo | null> {
    const apiKey = await this.getOpenSeaApiKey();
    const headers: Record<string, string> = {
      accept: 'application/json',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    };
    if (apiKey) headers['x-api-key'] = apiKey;

    try {
      const colUrl = `https://api.opensea.io/api/v2/collections/${slug}`;
      const res = await fetch(colUrl, { headers, signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const colData = (await res.json()) as any;
        let contractAddr = '';
        let detectedChain = chainKey;

        if (Array.isArray(colData.contracts) && colData.contracts.length > 0) {
          contractAddr = colData.contracts[0].address || '';
          detectedChain = colData.contracts[0].chain || chainKey;
        }

        return {
          name: colData.name || slug,
          symbol: null,
          collectionName: colData.name || slug,
          imageUrl: resolveIpfsUrl(colData.image_url),
          floorPriceEth: null,
          chainKey: detectedChain,
          contractAddress: contractAddr,
          source: 'opensea',
        };
      }
    } catch {
      // ignore
    }
    return null;
  }

  private async fetchFromOpenSeaContract(chainKey: string, address: string): Promise<NftContractInfo | null> {
    const apiKey = await this.getOpenSeaApiKey();
    if (!apiKey) return null;

    const headers: Record<string, string> = {
      accept: 'application/json',
      'user-agent': 'MintBot/1.0',
      'x-api-key': apiKey,
    };

    try {
      const url = `https://api.opensea.io/api/v2/chain/${chainKey}/contract/${address}`;
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const data = (await res.json()) as any;
        return {
          name: data.name || null,
          symbol: data.symbol || null,
          collectionName: data.name || null,
          imageUrl: resolveIpfsUrl(data.image_url),
          floorPriceEth: null,
          chainKey,
          contractAddress: address,
          source: 'opensea',
        };
      }
    } catch {
      // ignore
    }
    return null;
  }

  private async fetchFromOnChain(chainKey: string, address: string): Promise<NftContractInfo | null> {
    try {
      const chainRow = await this.chains.findByKey(chainKey);
      const profile = getChainProfile(chainKey);
      const rpcs = chainRow?.publicRpcs?.length ? chainRow.publicRpcs : profile?.rpc?.public ?? [];
      if (!rpcs.length) return null;

      const provider = new ethers.JsonRpcProvider(rpcs[0]);
      const contract = new Contract(address, ERC721_MINIMAL_ABI, provider);

      const [nameRes, symbolRes, tokenUriRes, contractUriRes] = await Promise.allSettled([
        contract.name(),
        contract.symbol(),
        contract.tokenURI(1).catch(() => contract.tokenURI(0)).catch(() => contract.uri(1)),
        contract.contractURI(),
      ]);

      const nameVal = nameRes.status === 'fulfilled' ? nameRes.value : null;
      const symbolVal = symbolRes.status === 'fulfilled' ? symbolRes.value : null;

      let uri = contractUriRes.status === 'fulfilled' ? contractUriRes.value : 
                (tokenUriRes.status === 'fulfilled' ? tokenUriRes.value : null);

      let imageUrl: string | null = null;

      if (uri) {
        uri = resolveIpfsUrl(uri);
        if (uri.startsWith('data:application/json;base64,')) {
          try {
            const json = JSON.parse(Buffer.from(uri.split(',')[1], 'base64').toString('utf8'));
            imageUrl = resolveIpfsUrl(json.image || json.image_url);
          } catch {}
        } else if (uri.startsWith('http')) {
          try {
            const res = await fetch(uri, { signal: AbortSignal.timeout(3500) });
            if (res.ok) {
              const json = (await res.json()) as any;
              imageUrl = resolveIpfsUrl(json.image || json.image_url);
            }
          } catch {}
        }
      }

      if (!nameVal && !symbolVal) return null;

      return {
        name: nameVal,
        symbol: symbolVal,
        collectionName: nameVal,
        imageUrl,
        floorPriceEth: null,
        chainKey,
        contractAddress: address,
        source: 'onchain',
      };
    } catch {
      return null;
    }
  }
}
