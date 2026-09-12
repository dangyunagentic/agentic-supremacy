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
  /** Original stage display name from OpenSea (dev-provided, e.g. "Game WL"). */
  name: string | null;
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
  private readonly apiKeys: string[];
  private keyIndex = 0;

  constructor(apiKeysInput?: string | string[] | null) {
    let rawKeys: string[] = [];
    if (Array.isArray(apiKeysInput)) {
      rawKeys = apiKeysInput;
    } else if (typeof apiKeysInput === 'string' && apiKeysInput.trim().length > 0) {
      rawKeys = apiKeysInput.split(/[\n,;]+/);
    } else {
      const envKeys = process.env.OPENSEA_API_KEYS || process.env.OPENSEA_API_KEY;
      if (envKeys) rawKeys = envKeys.split(/[\n,;]+/);
    }
    this.apiKeys = rawKeys.map((k) => k.trim()).filter(Boolean);
  }

  get configured(): boolean {
    return this.apiKeys.length > 0;
  }

  get keyCount(): number {
    return this.apiKeys.length;
  }

  private getKey(): string {
    if (this.apiKeys.length === 0) {
      throw new OpenSeaApiError(
        'OpenSea API key not configured; allowlist/FCFS mints are unavailable',
        'OPENSEA_NOT_CONFIGURED',
      );
    }
    const key = this.apiKeys[this.keyIndex % this.apiKeys.length];
    this.keyIndex = (this.keyIndex + 1) % this.apiKeys.length;
    return key;
  }

  private async graphql<T extends GraphqlResponse>(
    query: string,
    variables: Record<string, string>,
    maxRetries = 3,
  ): Promise<T> {
    let attempt = 0;
    while (attempt <= maxRetries) {
      attempt++;
      const currentKey = this.getKey();
      try {
        const res = await fetch(OPENSEA_GRAPHQL_URL, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${currentKey}`,
          },
          body: JSON.stringify({ query, variables }),
          signal: AbortSignal.timeout(10000),
        });

        if (res.status === 429) {
          if (attempt <= maxRetries) {
            const jitter = Math.floor(Math.random() * 150);
            const backoffMs = Math.min(3000, Math.floor(300 * Math.pow(2, attempt - 1)) + jitter);
            await new Promise((r) => setTimeout(r, backoffMs));
            continue;
          }
          throw new OpenSeaApiError(`OpenSea rate limit exceeded (HTTP 429) after ${maxRetries} retries`);
        }

        if ((res.status === 502 || res.status === 503 || res.status === 504) && attempt <= maxRetries) {
          const backoffMs = 250 * attempt;
          await new Promise((r) => setTimeout(r, backoffMs));
          continue;
        }

        if (!res.ok) {
          throw new OpenSeaApiError(`OpenSea API responded ${res.status}`);
        }

        const json = (await res.json()) as T;
        if (json.errors?.length) {
          const errMsg = json.errors.map((e) => e.message).join('; ');
          if (/rate limit|too many requests|throttl/i.test(errMsg) && attempt <= maxRetries) {
            const jitter = Math.floor(Math.random() * 150);
            const backoffMs = Math.min(3000, Math.floor(300 * Math.pow(2, attempt - 1)) + jitter);
            await new Promise((r) => setTimeout(r, backoffMs));
            continue;
          }
          throw new OpenSeaApiError(errMsg);
        }

        return json;
      } catch (err) {
        if (err instanceof OpenSeaApiError && err.code === 'OPENSEA_NOT_CONFIGURED') {
          throw err;
        }
        if (attempt <= maxRetries && !/not configured/i.test(String(err))) {
          const backoffMs = 250 * attempt;
          await new Promise((r) => setTimeout(r, backoffMs));
          continue;
        }
        throw err;
      }
    }
    throw new OpenSeaApiError('OpenSea request failed after retries');
  }

  /** The active mint stage for a collection (slug-based). */
  async fetchStage(slug: string, chainKey: string): Promise<MintStageInfo> {
    const query = `
      query MintStage($slug: String!, $chain: String!) {
        collection(slug: $slug, chain: $chain) {
          activeStage {
            __typename
            name
            startTime
            endTime
          }
        }
      }`;
    const json = await this.graphql(query, { slug, chain: chainKey });
    const stage = json.data?.collection?.activeStage;
    if (!stage) return { kind: 'none', startTime: null, endTime: null, name: null };

    const raw = `${stage.__typename ?? ''} ${(stage as any).name ?? ''}`.toLowerCase();
    const kind = raw.includes('fcfs') || raw.includes('first come')
      ? 'fcfs'
      : raw.includes('allow') || raw.includes('gtd') || raw.includes('list')
        ? 'allowlist'
        : raw.includes('public')
          ? 'public'
          : 'fcfs';
    return {
      kind,
      startTime: stage.startTime ?? null,
      endTime: stage.endTime ?? null,
      name: (stage as any).name ?? null,
    };
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
