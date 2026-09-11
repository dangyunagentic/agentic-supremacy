// MintEngine: composes the ported primitives into the PRD's 5-phase
// execution pipeline. Pure orchestration: no database access here.

import { JsonRpcProvider, Wallet, keccak256, getBytes, toUtf8Bytes, type Provider } from 'ethers';
import { gweiToWei, PRE_SIGN_LEAD_MS } from '@mintbot/shared';
import { buildLocalMintPlan, fetchPublicDrop, type LocalMintPlan, type PublicDrop } from './seadrop-public';
import { buildSignedPlans, type SignedMintPlan } from './seadrop-signed';
import { UniversalLaunchpadEngine, type UniversalMintPlan } from './universal-launchpad';
import { blastToAll, waitForReceipt, type BlastResult } from './rpc-blast';
import { warmConnections } from './connection-warmer';
import { waitForMintTime, waitForChainTime } from './timer';
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

  async waitUntil(fireAt: Date, earlyFireMs = 0): Promise<void> {
    // Fire based on the chain's own clock (block timestamp), not the local
    // wall clock, so we hit the exact on-chain stage-open second.
    const targetSec = Math.floor(fireAt.getTime() / 1000) + Math.floor(earlyFireMs / 1000);
    try {
      await waitForChainTime(this.provider, targetSec, 60_000, 100);
    } catch {
      // fallback to wall-clock wait
      await waitForMintTime(fireAt, PRE_SIGN_LEAD_MS + earlyFireMs);
    }
  }

  /**
   * Hard on-chain gate: polls the SeaDrop contract until the public drop
   * startTime has actually passed on-chain. Prevents blasting N seconds
   * before the stage opens (which reverts with NotActive). Bounded by timeout.
   */
  async waitForStageOpen(
    nftContract: string,
    expectedStart?: number | null,
    timeoutMs = 30_000,
    pollMs = 250,
  ): Promise<{ startTime: number; endTime: number } | null> {
    const deadline = Date.now() + timeoutMs;
    let lastDrop: PublicDrop | null = null;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        lastDrop = await fetchPublicDrop(this.provider, this.chain.seadropAddress, nftContract);
        if (lastDrop && lastDrop.startTime > 0) {
          const nowSec = Math.floor(Date.now() / 1000);
          if (nowSec >= lastDrop.startTime) {
            return { startTime: lastDrop.startTime, endTime: lastDrop.endTime };
          }
        } else if (expectedStart) {
          // No drop configured yet but we know the expected start — wait for it.
          const nowSec = Math.floor(Date.now() / 1000);
          if (nowSec >= expectedStart) {
            return { startTime: expectedStart, endTime: 0 };
          }
        }
      } catch {
        // transient RPC error, keep polling
      }
      if (Date.now() > deadline) break;
      await new Promise((r) => setTimeout(r, pollMs));
    }
    // Timeout: if we know the expected start, return it so caller can decide.
    if (expectedStart) {
      const nowSec = Math.floor(Date.now() / 1000);
      if (nowSec >= expectedStart) return { startTime: expectedStart, endTime: 0 };
    }
    return lastDrop && lastDrop.startTime > 0
      ? { startTime: lastDrop.startTime, endTime: lastDrop.endTime }
      : null;
  }

  /**
   * Blast each signed tx to every RPC.
   *
   * Fire-and-forget dispatch is parallelised across wallets in bounded batches
   * (default 50 concurrently) so a large wallet set blasts as fast as the RPC
   * layer allows instead of one-wallet-at-a-time. `delayMs` still spaces batches
   * apart (and, when > 0, spaces each wallet) for providers that rate-limit a
   * sudden connection storm.
   */
  async blastAll(signed: SignedTx[], delayMs = 0, batchSize = 50): Promise<DispatchedTx[]> {
    const dispatched: DispatchedTx[] = new Array(signed.length);

    const blastOne = async (s: SignedTx, index: number): Promise<void> => {
      const { txHash, responsePromise } = blastToAll(s.rawTx, this.chain.rpcUrls);
      void responsePromise;
      dispatched[index] = { ...s, txHash, results: [] };
    };

    const chunked: SignedTx[][] = [];
    for (let i = 0; i < signed.length; i += batchSize) {
      chunked.push(signed.slice(i, i + batchSize));
    }

    // Track global offset so each wallet lands at the correct result index.
    let offset = 0;
    for (const chunk of chunked) {
      // Fire every wallet in this batch concurrently.
      await Promise.all(chunk.map((s, i) => blastOne(s, offset + i)));
      offset += chunk.length;
      if (delayMs > 0 && chunk !== chunked[chunked.length - 1]) {
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

  /**
   * Decode the revert reason of a failed tx by re-simulating the call at the
   * same block. Returns the raw revert string (e.g. "NotActive(...)") or null.
   */
  async decodeRevertReason(txHash: string): Promise<string | null> {
    try {
      const tx = await this.provider.getTransaction(txHash);
      if (!tx) return null;
      const blockNumber = tx.blockNumber ?? undefined;
      const callReq = {
        from: tx.from,
        to: tx.to ?? undefined,
        data: tx.data,
        value: tx.value,
        blockTag: blockNumber ?? 'latest',
      };
      try {
        await this.provider.call(callReq as any);
        return null; // call succeeded (unlikely for a reverted tx)
      } catch (err: any) {
        const msg = typeof err?.shortMessage === 'string' ? err.shortMessage : String(err?.message ?? err);
        return msg || null;
      }
    } catch {
      return null;
    }
  }

  /** Fetch the latest pending nonce for a wallet (used after a revert). */
  async getPendingNonce(address: string): Promise<number> {
    return this.provider.getTransactionCount(address, 'pending');
  }

  /** Sign a single raw tx (re-sign with a new nonce after a NotActive revert). */
  async signSingle(
    privateKey: string,
    to: string,
    data: string,
    value: bigint,
    gas: GasSpec,
    chainId: number,
    nonce: number,
  ): Promise<SignedTx> {
    const wallet = new Wallet(privateKey);
    const rawTx = await wallet.signTransaction({
      chainId,
      nonce,
      to,
      data,
      value,
      gasLimit: BigInt(gas.gasLimit),
      maxFeePerGas: gweiToWei(gas.maxFeeGwei),
      maxPriorityFeePerGas: gweiToWei(gas.maxPriorityGwei),
      type: 2,
    });
    return {
      walletAddress: wallet.address.toLowerCase(),
      rawTx,
      txHash: keccak256(rawTx),
    };
  }

  async destroy(): Promise<void> {
    await this.provider.destroy();
  }
}

export type { Provider };
