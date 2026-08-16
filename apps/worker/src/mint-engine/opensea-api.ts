// Ported from osnm-z's OpenSea integration.
//
// Allowlist/FCFS stages are signed: the calldata contains an OpenSea
// signature bound to the minter address, so it must be fetched per wallet,
// shortly before firing (the reference tool refreshes it at T-2s).

import type { Provider } from 'ethers';

const OPENSEA_GRAPHQL_URL = 'https://api.opensea.io/api/graphql';

export interface WalletMintAction {
  target: string;
  calldata: string;
  value: string; // wei, decimal string
  deadline?: string | null;
}

export interface MintStageInfo {
  kind: 'allowlist' | 'fcfs' | 'public' | 'none';
  startTime: string | null;
  endTime: string | null;
}

export class OpenSeaApiError extends Error {
  constructor(message: string, readonly code = 'OPENSEA_ERROR') {
    super(message);
    this.name = OpenSeaApiError.name;
  }
}

interface GraphqlResponse {
  data?: {
    collection?: {
      activeStage?: {
        __typename?: string;
        startTime?: string | null;
        endTime?: string | null;
        actions?: Array<{
          __typename?: string;
          target?: string;
          calldata?: string;
          value?: string;
          deadline?: string | null;
        }>;
      };
    };
  };
  errors?: Array<{ message?: string }>;
}

export class OpenSeaApiClient {
  constructor(private readonly apiKey: string | null) {}

  get configured(): boolean {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
  }

  private requireKey(): string {
    if (!this.configured) {
      throw new OpenSeaApiError(
        'OpenSea API key not configured; allowlist/FCFS mints are unavailable',
        'OPENSEA_NOT_CONFIGURED',
      );
    }
    return this.apiKey!;
  }

  private async graphql<T extends GraphqlResponse>(query: string, variables: Record<string, string>): Promise<T> {
    const res = await fetch(OPENSEA_GRAPHQL_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.requireKey()}`,
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!res.ok) {
      throw new OpenSeaApiError(`OpenSea API responded ${res.status}`);
    }
    const json = (await res.json()) as T;
    if (json.errors?.length) {
      throw new OpenSeaApiError(json.errors.map((e) => e.message).join('; '));
    }
    return json;
  }

  /** The active mint stage for a collection (slug-based). */
  async fetchStage(slug: string, chainKey: string): Promise<MintStageInfo> {
    const query = `
      query MintStage($slug: String!, $chain: String!) {
        collection(slug: $slug, chain: $chain) {
          activeStage {
            __typename
            startTime
            endTime
          }
        }
      }`;
    const json = await this.graphql(query, { slug, chain: chainKey });
    const stage = json.data?.collection?.activeStage;
    if (!stage) return { kind: 'none', startTime: null, endTime: null };
    const kind = stage.__typename?.toLowerCase().includes('fcfs')
      ? 'fcfs'
      : stage.__typename?.toLowerCase().includes('allow')
        ? 'allowlist'
        : 'public';
    return { kind, startTime: stage.startTime ?? null, endTime: stage.endTime ?? null };
  }

  /** Per-wallet signed mint action. Must be fetched fresh, close to fire time. */
  async fetchWalletMintAction(
    slug: string,
    chainKey: string,
    walletAddress: string,
  ): Promise<WalletMintAction | null> {
    const query = `
      query WalletMintAction($slug: String!, $chain: String!, $address: String!) {
        collection(slug: $slug, chain: $chain) {
          activeStage {
            actions(address: $address) {
              __typename
              target
              calldata
              value
              deadline
            }
          }
        }
      }`;
    const json = await this.graphql(query, { slug, chain: chainKey, address: walletAddress });
    const action = json.data?.collection?.activeStage?.actions?.find(
      (a) => a.__typename === 'WalletMintAction' || a.calldata,
    );
    if (!action?.calldata || !action.target) return null;
    return {
      target: action.target,
      calldata: action.calldata,
      value: action.value ?? '0',
      deadline: action.deadline ?? null,
    };
  }
}

/** Cheap eligibility probe used by the pre-flight (osnm-z eligibility checker). */
export async function checkEligibility(
  client: OpenSeaApiClient,
  slug: string,
  chainKey: string,
  walletAddress: string,
  _provider: Provider,
): Promise<boolean> {
  try {
    const action = await client.fetchWalletMintAction(slug, chainKey, walletAddress);
    return action !== null;
  } catch {
    return false;
  }
}
