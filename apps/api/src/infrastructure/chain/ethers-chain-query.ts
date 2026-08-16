import { Inject, Injectable } from '@nestjs/common';
import { Contract, JsonRpcProvider } from 'ethers';
import { getChainProfile, type PublicDropInfo } from '@mintbot/shared';
import { TOKENS } from '../../domain/tokens';
import type { ChainQueryPort } from '../../domain/ports/ports';
import type { ChainRepository } from '../../domain/repositories/system.repository';
import { NotFoundError } from '../../application/common/app-error';

const PUBLIC_DROP_ABI = [
  'function getPublicDrop(address nftContract) view returns (tuple(uint80 mintPrice, uint48 startTime, uint48 endTime, uint16 maxTotalMintableByWallet, uint16 feeBps, bool restrictFeeRecipients))',
];

/** Read-only chain access for the API process. The worker owns execution. */
@Injectable()
export class EthersChainQuery implements ChainQueryPort {
  constructor(
    @Inject(TOKENS.ChainRepository) private readonly chains: ChainRepository,
  ) {}

  private async primaryRpc(chainKey: string): Promise<string> {
    const dbChain = await this.chains.findByKey(chainKey);
    if (dbChain && dbChain.publicRpcs.length > 0) return dbChain.publicRpcs[0];
    const profile = getChainProfile(chainKey);
    if (profile) return profile.rpc.public[0];
    throw new NotFoundError('Chain');
  }

  private async seadropAddress(chainKey: string): Promise<string | undefined> {
    const chain = await this.chains.findByKey(chainKey);
    return chain?.seadropAddress ?? getChainProfile(chainKey)?.seadropAddress;
  }

  async getNativeBalance(chainKey: string, address: string): Promise<bigint> {
    const provider = new JsonRpcProvider(await this.primaryRpc(chainKey));
    try {
      return await provider.getBalance(address);
    } finally {
      await provider.destroy();
    }
  }

  async getPublicDropStart(chainKey: string, collection: string): Promise<number | null> {
    const drop = await this.getPublicDrop(chainKey, collection);
    return drop && drop.startTime > 0 ? drop.startTime : null;
  }

  async getPublicDrop(chainKey: string, collection: string): Promise<PublicDropInfo | null> {
    if (!/^0x[a-fA-F0-9]{40}$/.test(collection)) return null;
    const provider = new JsonRpcProvider(await this.primaryRpc(chainKey));
    try {
      const seadrop = await this.seadropAddress(chainKey);
      if (!seadrop) return null;
      const contract = new Contract(seadrop, PUBLIC_DROP_ABI, provider);
      const drop = await contract.getPublicDrop(collection);
      const info: PublicDropInfo = {
        mintPrice: BigInt(drop.mintPrice).toString(),
        startTime: Number(drop.startTime),
        endTime: Number(drop.endTime),
        maxTotalMintableByWallet: Number(drop.maxTotalMintableByWallet),
      };
      if (info.startTime === 0 && info.endTime === 0 && info.maxTotalMintableByWallet === 0) {
        return null;
      }
      return info;
    } catch {
      return null;
    } finally {
      await provider.destroy();
    }
  }

  /** Median eth_blockNumber round-trip over three probes, in milliseconds. */
  async pingRpc(url: string): Promise<number> {
    const body = JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 });
    const samples: number[] = [];
    for (let i = 0; i < 3; i++) {
      const t0 = Date.now();
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await res.json();
      samples.push(Date.now() - t0);
    }
    samples.sort((a, b) => a - b);
    return samples[Math.floor(samples.length / 2)];
  }
}
