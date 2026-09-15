// Signed-stage mint plan.
//
// Unlike the public path, calldata here is produced by OpenSea per wallet, so
// the "plan" is fetched per wallet right before signing (we refresh it after
// pre-sign lead to keep the action fresh). Quantity is baked into the signed
// calldata, so the fetch must use the task's mint quantity.

import type { OpenSeaApiClient } from './opensea-api';
import type { WalletMintAction, SignedMintPlan } from './opensea-api';

export type { SignedMintPlan } from './opensea-api';

export type SignedProgressCallback = (
  completed: number,
  total: number,
  eligible: number,
) => Promise<void> | void;

export async function buildSignedPlans(
  client: OpenSeaApiClient,
  slug: string,
  chainKey: string,
  walletAddresses: string[],
  _provider: unknown,
  onProgress?: SignedProgressCallback,
  lanes?: number,
  quantity = 1,
): Promise<SignedMintPlan[]> {
  const total = walletAddresses.length;
  if (total === 0) return [];

  const configuredLanes = lanes ?? (parseInt(process.env.OPENSEA_LANES || '', 10) || 16);
  const effectiveLanes = Math.max(1, Math.min(configuredLanes, total));

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

  const plans: SignedMintPlan[] = [];
  const ineligible: string[] = [];

  walletAddresses.forEach((address, i) => {
    const action: WalletMintAction | null = actions[i];
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
