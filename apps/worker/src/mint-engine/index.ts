// MintEngine: composes the ported primitives into the PRD's 5-phase
// execution pipeline. Pure orchestration: no database access here.

import { JsonRpcProvider, Wallet, keccak256, type Provider } from 'ethers';
import { gweiToWei, PRE_SIGN_LEAD_MS } from '@mintbot/shared';
import { buildLocalMintPlan, fetchPublicDrop, type LocalMintPlan } from './seadrop-public';
import { buildSignedPlans, type SignedMintPlan } from './seadrop-signed';
import { blastToAll, waitForReceipt, type BlastResult } from './rpc-blast';
import { warmConnections } from './connection-warmer';
import { waitForMintTime } from './timer';
import { OpenSeaApiClient } from './opensea-api';

export interface EngineChain {
  key: string;
  chainId: number;
  name: string;
  explorer: string;
  rpcUrls: string[];
  seadropAddress: string;
}

export interface EngineWallet {
  address: string;
  privateKey: string;
}

export interface GasSpec {
  maxFeeGwei: number;
  maxPriorityGwei: number;
  gasLimit: number;
}

export interface ReceiptOptions {
  timeoutMs: number;
  baseMs: number;
  maxMs: number;
}

export type MintPlanKind = 'public' | 'signed';

export interface BuiltPlan {
  kind: MintPlanKind;
  /** Public mode: one shared plan for every wallet. */
  shared?: LocalMintPlan;
  /** Signed mode: one plan per wallet (OpenSea-calldata). */
  perWallet?: SignedMintPlan[];
}

export interface SignedTx {
  walletAddress: string;
  rawTx: string;
  txHash: string;
}

export interface DispatchedTx extends SignedTx {
  results: BlastResult[];
}

export interface ReceiptOutcome {
  walletAddress: string;
  txHash: string;
  found: boolean;
  status: number | null;
  blockNumber: number | null;
  gasUsed: number | null;
}

export class MintEngine {
  readonly provider: JsonRpcProvider;
  private readonly openSea: OpenSeaApiClient;

  constructor(
    readonly chain: EngineChain,
    openSeaApiKey: string | null,
  ) {
    this.provider = new JsonRpcProvider(chain.rpcUrls[0]);
    this.openSea = new OpenSeaApiClient(openSeaApiKey);
  }

  /** Fails fast when the RPC is on a different network than expected. */
  async assertNetwork(): Promise<number> {
    const network = await this.provider.getNetwork();
    if (Number(network.chainId) !== this.chain.chainId) {
      throw new Error(
        `RPC chain id ${network.chainId} does not match ${this.chain.key} (${this.chain.chainId})`,
      );
    }
    return Number(network.chainId);
  }

  async getNativeBalances(addresses: string[]): Promise<Map<string, bigint>> {
    const entries = await Promise.all(
      addresses.map(async (a) => [a, await this.provider.getBalance(a)] as const),
    );
    return new Map(entries);
  }

  /** Upfront reservation: gasLimit x maxFee + mint value (reference rule). */
  validateBalances(
    balances: Map<string, bigint>,
    wallets: EngineWallet[],
    gas: GasSpec,
    valuePerWallet: bigint,
  ): { ok: boolean; insufficient: Array<{ address: string; have: bigint; need: bigint }> } {
    const upfront = BigInt(gas.gasLimit) * gweiToWei(gas.maxFeeGwei) + valuePerWallet;
    const insufficient = wallets
      .map((w) => ({ address: w.address, have: balances.get(w.address) ?? 0n, need: upfront }))
      .filter((b) => b.have < b.need);
    return { ok: insufficient.length === 0, insufficient };
  }

  /** Mint-mode resolution for `auto`: public drop first, then OpenSea stage. */
  async resolveMode(
    requested: 'public' | 'allowlist' | 'fcfs' | 'auto',
    collection: string,
  ): Promise<{ mode: MintPlanKind; isAddress: boolean }> {
    const isAddress = /^0x[a-fA-F0-9]{40}$/.test(collection);
    if (requested !== 'auto') {
      return { mode: requested === 'public' ? 'public' : 'signed', isAddress };
    }
    if (isAddress) {
      const drop = await fetchPublicDrop(this.provider, this.chain.seadropAddress, collection);
      if (drop) return { mode: 'public', isAddress };
      throw new Error(
        'Auto mode: no public drop on-chain and no slug for the allowlist/FCFS path. ' +
          'Pass an OpenSea collection slug or set mintMode explicitly.',
      );
    }
    return { mode: 'signed', isAddress };
  }

  async buildPlan(
    mode: MintPlanKind,
    collection: string,
    quantity: number,
    wallets: EngineWallet[],
  ): Promise<BuiltPlan> {
    if (mode === 'public') {
      const plan = await buildLocalMintPlan(
        this.provider,
        this.chain.seadropAddress,
        collection,
        quantity,
      );
      if (!plan) throw new Error('No public drop configured on this contract');
      if (plan.drop.maxTotalMintableByWallet > 0 && quantity > plan.drop.maxTotalMintableByWallet) {
        throw new Error(
          `Quantity ${quantity} exceeds the per-wallet limit ${plan.drop.maxTotalMintableByWallet}`,
        );
      }
      return { kind: 'public', shared: plan };
    }
    const plans = await buildSignedPlans(
      this.openSea,
      collection, // slug
      this.chain.key,
      wallets.map((w) => w.address),
      this.provider,
    );
    return { kind: 'signed', perWallet: plans };
  }

  /** Capture nonces and sign every transaction. Returns pre-serialized txs. */
  async signAll(
    wallets: EngineWallet[],
    plan: BuiltPlan,
    gas: GasSpec,
    chainId: number,
  ): Promise<SignedTx[]> {
    const maxFeePerGas = gweiToWei(gas.maxFeeGwei);
    const maxPriorityFeePerGas = gweiToWei(gas.maxPriorityGwei);

    const signed: SignedTx[] = [];
    for (const engineWallet of wallets) {
      const ethersWallet = new Wallet(engineWallet.privateKey);
      const value =
        plan.kind === 'public'
          ? plan.shared!.value
          : plan.perWallet!.find((p) => p.walletAddress === engineWallet.address)?.value ?? 0n;
      const to =
        plan.kind === 'public'
          ? plan.shared!.to
          : plan.perWallet!.find((p) => p.walletAddress === engineWallet.address)?.to;
      const data =
        plan.kind === 'public'
          ? plan.shared!.data
          : plan.perWallet!.find((p) => p.walletAddress === engineWallet.address)?.data;

      if (ethersWallet.address.toLowerCase() !== engineWallet.address.toLowerCase()) {
        throw new Error(`Key/address mismatch for ${engineWallet.address}`);
      }
      if (!to || data === undefined) {
        throw new Error(`No mint action available for wallet ${engineWallet.address}`);
      }

      const nonce = await this.provider.getTransactionCount(engineWallet.address, 'pending');
      const rawTx = await ethersWallet.signTransaction({
        chainId,
        nonce,
        to,
        data,
        value,
        gasLimit: BigInt(gas.gasLimit),
        maxFeePerGas,
        maxPriorityFeePerGas,
        type: 2,
      });

      signed.push({
        walletAddress: engineWallet.address.toLowerCase(),
        rawTx,
        txHash: keccak256(rawTx),
      });
    }
    return signed;
  }

  async warm(): Promise<number> {
    return warmConnections(this.chain.rpcUrls);
  }

  async waitUntil(fireAt: Date): Promise<void> {
    await waitForMintTime(fireAt, PRE_SIGN_LEAD_MS);
  }

  /** Blast each signed tx to every RPC. Does not wait for responses. */
  blastAll(signed: SignedTx[]): DispatchedTx[] {
    return signed.map((s) => {
      const { txHash, responsePromise } = blastToAll(s.rawTx, this.chain.rpcUrls);
      void responsePromise;
      return { ...s, txHash, results: [] };
    });
  }

  async collectReceipts(
    dispatched: DispatchedTx[],
    options: ReceiptOptions,
  ): Promise<ReceiptOutcome[]> {
    const outcomes = await Promise.all(
      dispatched.map(async (d): Promise<ReceiptOutcome> => {
        const receipt = await waitForReceipt(this.provider, d.txHash, options);
        if (!receipt.found) {
          return {
            walletAddress: d.walletAddress,
            txHash: d.txHash,
            found: false,
            status: null,
            blockNumber: null,
            gasUsed: null,
          };
        }
        return {
          walletAddress: d.walletAddress,
          txHash: d.txHash,
          found: true,
          status: receipt.status,
          blockNumber: receipt.blockNumber,
          gasUsed: Number(receipt.gasUsed),
        };
      }),
    );
    return outcomes;
  }

  async getReceiptLogs(txHash: string) {
    const receipt = await this.provider.getTransactionReceipt(txHash);
    return receipt?.logs ?? [];
  }

  async destroy(): Promise<void> {
    await this.provider.destroy();
  }
}

export type { Provider };
