// Signed-stage mint plan.
//
// Unlike the public path, calldata here is produced by OpenSea per wallet, so
// the "plan" is fetched per wallet right before signing (we refresh it after
// pre-sign lead to keep the action fresh). Quantity is baked into the signed
// calldata, so the fetch must use the task's mint quantity.
//
// The mint job starts at T-10s before the stage opens, so the first fetch
// attempt usually lands BEFORE the stage is active (OpenSea rejects with
// 409/422). When `retryUntilMs` is set, we re-fetch until actions appear or
// the deadline passes — this is what wins FCFS wars.

import type { OpenSeaApiClient } from './opensea-api';
import type { WalletMintAction, SignedMintPlan } from './opensea-api';

export type { SignedMintPlan } from './opensea-api';

export type SignedProgressCallback = (
  completed: number,
  total: number,
  eligible: number,
) => Promise<void> | void;

export interface SignedPlanOptions {
  /** Retry the full wallet sweep until this epoch-ms when nothing is eligible. */
  retryUntilMs?: number;
  /** Delay between overlapping poll waves (default 75ms with 2 lanes). */
  retryIntervalMs?: number;
  /** Number of overlapping poll waves (default 2). */
  pollWaves?: number;
}

export async function buildSignedPlans(
  client: OpenSeaApiClient,
  slug: string,
  chainKey: string,
  walletAddresses: string[],
  _provider: unknown,
  onProgress?: SignedProgressCallback,
  lanes?: number,
  quantity = 1,
  options?: SignedPlanOptions,
): Promise<SignedMintPlan[]> {
  const total = walletAddresses.length;
  if (total === 0) return [];

  const configuredLanes = lanes ?? (parseInt(process.env.OPENSEA_LANES || '', 10) || 16);
  const effectiveLanes = Math.max(1, Math.min(configuredLanes, total));

  async function sweep(): Promise<WalletMintAction[]> {
    const actions: Array<WalletMintAction | null> = new Array(total);
    let cursor = 0;
    let completed = 0;
    let eligibleCount = 0;

    async function worker() {
      while (true) {
        const idx = cursor++;
        if (idx >= total) break;
        const address = walletAddresses[idx];
        try {
          const { action } = await client.fetchWalletMintAction(slug, chainKey, address, quantity);
          actions[idx] = action;
          if (action) eligibleCount++;
        } catch {
          actions[idx] = null;
        }
        completed++;
        if (onProgress) {
          try {
            await onProgress(completed, total, eligibleCount);
          } catch {
            // ignore progress handler failures
          }
        }
      }
    }

    const workers = Array.from({ length: effectiveLanes }, () => worker());
    await Promise.all(workers);
    return actions as Array<WalletMintAction | null> as Array<WalletMintAction>;
  }

  // First sweep, then overlapping poll waves while nothing is eligible yet
  // (stage not open). Waves are staggered by `interval` and run concurrently,
  // so the detection gap is ~interval (75ms) instead of a full round-trip
  // (~300-500ms via OpenSea). First wallet to appear wins immediately.
  let actions = await sweep();
  if (
    actions.every((a) => a === null) &&
    options?.retryUntilMs !== undefined &&
    Date.now() < options.retryUntilMs
  ) {
    const interval = options.retryIntervalMs ?? 75;
    const waves = Math.max(1, options.pollWaves ?? 2);
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearInterval(timer);
        resolve();
      };
      // Each wave re-checks; the first wave that sees an action finishes us.
      const runWave = async () => {
        while (!done && Date.now() < (options!.retryUntilMs as number)) {
          const next = await sweep();
          if (!next.every((a) => a === null)) {
            actions = next;
            finish();
            return;
          }
          await new Promise((r) => setTimeout(r, interval * waves));
        }
        finish();
      };
      for (let w = 0; w < waves; w++) {
        setTimeout(() => void runWave(), w * interval);
      }
      // Absolute deadline guard
      const timer = setInterval(() => {
        if (Date.now() >= (options!.retryUntilMs as number)) finish();
      }, 100);
    });
  }

  const plans: SignedMintPlan[] = [];
  const ineligible: string[] = [];

  walletAddresses.forEach((address, i) => {
    const action = actions[i];
    if (!action) {
      ineligible.push(address);
      return;
    }
    plans.push({
      walletAddress: address,
      to: action.target,
      data: action.calldata,
      value: BigInt(action.value),
    });
  });

  if (plans.length === 0 && ineligible.length > 0) {
    throw new Error(
      `No wallet is eligible for this ${chainKey} mint (checked ${ineligible.length} wallet(s))`,
    );
  }

  return plans;
}
