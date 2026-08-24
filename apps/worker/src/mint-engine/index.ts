// MintEngine: composes the ported primitives into the PRD's 5-phase
// execution pipeline. Pure orchestration: no database access here.

import { JsonRpcProvider, Wallet, keccak256, getBytes, toUtf8Bytes, type Provider } from 'ethers';
import { gweiToWei, PRE_SIGN_LEAD_MS } from '@mintbot/shared';
import { buildLocalMintPlan, fetchPublicDrop, type LocalMintPlan } from './seadrop-public';
import { buildSignedPlans, type SignedMintPlan } from './seadrop-signed';
import { UniversalLaunchpadEngine, type UniversalMintPlan } from './universal-launchpad';
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
  private readonly universal = new UniversalLaunchpadEngine();

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
      try {
        const plan = await buildLocalMintPlan(
          this.provider,
          this.chain.seadropAddress,
          collection,
          quantity,
        );
        if (plan) {
          if (plan.drop.maxTotalMintableByWallet > 0 && quantity > plan.drop.maxTotalMintableByWallet) {
            throw new Error(
              `Quantity ${quantity} exceeds the per-wallet limit ${plan.drop.maxTotalMintableByWallet}`,
            );
          }
          return { kind: 'public', shared: plan };
        }
      } catch (err) {
        // Fallback to Universal Launchpad Engine (Scatter.art, Zora, Direct Contract)
      }

      // Universal Launchpad fallback (Scatter.art / Zora / Generic ERC-721)
      const uPlan = await this.universal.buildUniversalPlan(
        this.provider,
        this.chain.seadropAddress,
        collection,
        quantity,
        wallets[0]?.address ?? '',
        this.chain.key,
      );

      return {
        kind: 'public',
        shared: {
          to: uPlan.to,
          data: uPlan.data,
          value: uPlan.value,
          feeRecipient: '',
          drop: {
            mintPrice: uPlan.mintPrice,
            startTime: uPlan.startTime ?? 0,
            endTime: 0,
            maxTotalMintableByWallet: 0,
            feeBps: 0,
            restrictFeeRecipients: false,
          },
        },
      };
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
    nonceOverride?: number | null,
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

      const nonce =
        nonceOverride != null && nonceOverride >= 0
          ? nonceOverride
          : await this.provider.getTransactionCount(engineWallet.address, 'pending');
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

  /** Blast each signed tx to every RPC, optionally with a delay between wallets. */
  async blastAll(signed: SignedTx[], delayMs = 0): Promise<DispatchedTx[]> {
    const dispatched: DispatchedTx[] = [];
    for (const s of signed) {
      const { txHash, responsePromise } = blastToAll(s.rawTx, this.chain.rpcUrls);
      void responsePromise;
      dispatched.push({ ...s, txHash, results: [] });
      if (delayMs > 0 && s !== signed[signed.length - 1]) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
    return dispatched;
  }

  /** Submit signed raw txs as a Flashbots bundle to the public relay (ETH mainnet). */
  async submitFlashbots(rawTxs: string[], funderPrivateKey: string): Promise<string> {
    if (this.chain.chainId !== 1) {
      throw new Error('Flashbots relay is only available on Ethereum mainnet');
    }
    const relayUrl = process.env.FLASHBOTS_RELAY_URL ?? 'https://relay.flashbots.net';
    const builder = new Wallet(funderPrivateKey);
    const signature = `${builder.address}:${await builder.signMessage(getBytes(keccak256(toUtf8Bytes(JSON.stringify(rawTxs)))))}`;
    const res = await fetch(relayUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-flashbots-signature': signature },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_sendBundle',
        params: [{ txs: rawTxs, block: 'latest' }],
      }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Flashbots relay HTTP ${res.status}: ${text.slice(0, 160)}`);
    return text;
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
