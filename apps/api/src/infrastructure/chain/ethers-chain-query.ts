import { Inject, Injectable } from '@nestjs/common';
import { Contract, JsonRpcProvider } from 'ethers';
import { getChainProfile, jsonRpcRequest, type PublicDropInfo } from '@mintbot/shared';
import { TOKENS } from '../../domain/tokens';
import type { ChainQueryPort } from '../../domain/ports/ports';
import type { ChainRepository } from '../../domain/repositories/system.repository';
import { NotFoundError } from '../../application/common/app-error';

const PUBLIC_DROP_ABI = [
  'function getPublicDrop(address nftContract) view returns (tuple(uint80 mintPrice, uint48 startTime, uint48 endTime, uint16 maxTotalMintableByWallet, uint16 feeBps, bool restrictFeeRecipients))',
];

const TOKEN_ABI = [
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function transfer(address to, uint256 amount) returns (bool)',
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

  async getTokenBalance(
    chainKey: string,
    address: string,
    token: string,
  ): Promise<{ balance: bigint; decimals: number; symbol: string }> {
    const provider = new JsonRpcProvider(await this.primaryRpc(chainKey));
    try {
      const iface = TOKEN_ABI;
      const contract = new Contract(token, iface, provider);
      const [balance, decimals, symbol] = await Promise.all([
        contract.balanceOf(address),
        contract.decimals(),
        contract.symbol(),
      ]);
      return {
        balance: BigInt(balance),
        decimals: Number(decimals),
        symbol: String(symbol),
      };
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

  /** Median eth_blockNumber round-trip over three probes, in milliseconds.
   *  vps = full round-trip from this server (network + provider processing),
   *  rpc = time-to-first-byte (provider processing + upstream hop, excludes
   *  the download of the response body). */
  async pingRpc(url: string): Promise<{ vps: number; rpc: number }> {
    const body = JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 });
    const samples: { vps: number; rpc: number }[] = [];
    const isWs = /^wss?:\/\//i.test(url);
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      if (isWs) {
        // WebSocket transport: measure a full round-trip (vps). ttfb is
        // approximated as the open+request round trip; there is no separate
        // header-first signal, so both metrics track the same sample.
        await jsonRpcRequest(url, 'eth_blockNumber', []);
        const total = performance.now() - t0;
        samples.push({ vps: total, rpc: total });
        continue;
      }
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const ttfb = performance.now() - t0;
      await res.json();
      const total = performance.now() - t0;
      samples.push({ vps: total, rpc: ttfb });
    }
    const byVps = [...samples].sort((a, b) => a.vps - b.vps);
    const byRpc = [...samples].sort((a, b) => a.rpc - b.rpc);
    const mid = Math.floor(samples.length / 2);
    return {
      vps: Math.round(byVps[mid].vps),
      rpc: Math.round(byRpc[mid].rpc),
    };
  }
}
