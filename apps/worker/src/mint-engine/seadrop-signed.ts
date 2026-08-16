// Signed-stage mint plan, ported from osnm-z's flow.
//
// Unlike the public path, calldata here is produced by OpenSea per wallet, so
// the "plan" is fetched per wallet right before signing (T-2s in the
// reference tool; we refresh after pre-sign lead to keep the action fresh).

import type { Provider } from 'ethers';
import type { OpenSeaApiClient, WalletMintAction } from './opensea-api';

export interface SignedMintPlan {
  walletAddress: string;
  to: string;
  data: string;
  value: bigint;
}

export async function buildSignedPlans(
  client: OpenSeaApiClient,
  slug: string,
  chainKey: string,
  walletAddresses: string[],
  _provider: Provider,
): Promise<SignedMintPlan[]> {
  const actions = await Promise.all(
    walletAddresses.map((address) => client.fetchWalletMintAction(slug, chainKey, address)),
  );

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
