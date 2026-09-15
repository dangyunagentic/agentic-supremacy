// OpenSea Drops v2 REST integration.
//
// The legacy GraphQL endpoint (api.opensea.io/api/graphql) is dead (404).
// Allowlist/GTD/FCFS stages and per-wallet signed mint actions now come from
// the documented Drops API:
//   GET  /api/v2/drops/{slug}           -> active_stage / next_stage info
//   POST /api/v2/drops/{slug}/mint      -> {to, data, value} signed action
//   GET  /api/v2/chain/{chain}/contract/{address} -> slug resolution

export interface WalletMintAction {
  target: string;
  calldata: string;
  value: string; // wei, decimal string
}

export interface SignedMintPlan {
  walletAddress: string;
  to: string;
  data: string;
  value: bigint;
}

export interface MintStageInfo {
  kind: 'allowlist' | 'fcfs' | 'public' | 'none';
  startTime: string | null;
  endTime: string | null;
  /** Original stage display name from OpenSea (dev-provided, e.g. "Game WL"). */
  name: string | null;
}

/** Result of a per-wallet mint-action fetch, with a human-readable reason. */
export interface WalletActionResult {
  action: WalletMintAction | null;
  reason: string | null;
}

export class OpenSeaApiError extends Error {
  constructor(message: string, readonly code = 'OPENSEA_ERROR') {
    super(message);
    this.name = OpenSeaApiError.name;
  }
}

const OPENSEA_API_BASE = 'https://api.opensea.io';

// Deployment chain keys -> OpenSea chain identifiers.
const CHAIN_MAP: Record<string, string> = {
  ethereum: 'ethereum',
  mainnet: 'ethereum',
  eth: 'ethereum',
  base: 'base',
  polygon: 'matic',
  matic: 'matic',
  optimism: 'optimism',
  op: 'optimism',
  arbitrum: 'arbitrum',
  arb: 'arbitrum',
  avalanche: 'avalanche',
  avax: 'avalanche',
  blast: 'blast',
  zora: 'zora',
  sei: 'sei',
  linea: 'linea',
  berachain: 'berachain',
  boba: 'boba',
  scroll: 'scroll',
  robinhood: 'robinhood',
};

interface DropStageResponse {
  uuid?: string;
  stage_type?: string;
  label?: string | null;
  price?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  max_per_wallet?: string | null;
}

interface DropResponse {
  collection_slug?: string;
  chain?: string;
  contract_address?: string;
  is_minting?: boolean;
  active_stage?: DropStageResponse | null;
  next_stage?: DropStageResponse | null;
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

  private async request(
    path: string,
    init: { method?: string; body?: unknown } = {},
    maxRetries = 3,
  ): Promise<{ status: number; json: any }> {
    let attempt = 0;
    while (true) {
      attempt++;
      try {
        const res = await fetch(`${OPENSEA_API_BASE}${path}`, {
          method: init.method ?? 'GET',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            'x-api-key': this.getKey(),
          },
          body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
          signal: AbortSignal.timeout(15000),
        });

        if (res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504) {
          if (attempt <= maxRetries) {
            const jitter = Math.floor(Math.random() * 150);
            const backoffMs = Math.min(3000, Math.floor(300 * Math.pow(2, attempt - 1)) + jitter);
            await new Promise((r) => setTimeout(r, backoffMs));
            continue;
          }
          throw new OpenSeaApiError(`OpenSea API responded ${res.status} after ${maxRetries} retries`);
        }

        const text = await res.text();
        let json: any = null;
        try {
          json = text ? JSON.parse(text) : null;
        } catch {
          json = null;
        }
        return { status: res.status, json };
      } catch (err) {
        if (err instanceof OpenSeaApiError && err.code === 'OPENSEA_NOT_CONFIGURED') throw err;
        if (attempt <= maxRetries) {
          await new Promise((r) => setTimeout(r, 250 * attempt));
          continue;
        }
        throw err;
      }
    }
  }

  private static stageKind(stage: DropStageResponse): 'allowlist' | 'fcfs' | 'public' {
    const raw = `${stage.stage_type ?? ''} ${stage.label ?? ''}`.toLowerCase();
    if (raw.includes('public')) return 'public';
    if (raw.includes('fcfs') || raw.includes('first come')) return 'fcfs';
    return 'allowlist';
  }

  /**
   * The relevant mint stage for a collection slug: the live stage when the
   * drop is minting, otherwise the next upcoming stage.
   */
  async fetchStage(slug: string, _chainKey?: string): Promise<MintStageInfo> {
    const { status, json } = await this.request(`/api/v2/drops/${encodeURIComponent(slug)}`);
    if (status === 404) return { kind: 'none', startTime: null, endTime: null, name: null };
    if (status !== 200) {
      const msg = json?.errors?.join('; ') ?? `OpenSea drops API responded ${status}`;
      throw new OpenSeaApiError(msg);
    }
    const drop = json as DropResponse;
    const stage = drop.is_minting && drop.active_stage ? drop.active_stage : drop.next_stage;
    if (!stage || !stage.start_time) {
      return { kind: 'none', startTime: null, endTime: null, name: null };
    }
    return {
      kind: OpenSeaApiClient.stageKind(stage),
      startTime: stage.start_time,
      endTime: stage.end_time ?? null,
      name: stage.label ?? null,
    };
  }

  /**
   * Per-wallet signed mint action. Must be fetched fresh, close to fire time;
   * only available while the target stage is the ACTIVE stage. Quantity is
   * baked into the signed calldata, so it must match the mint quantity.
   */
  async fetchWalletMintAction(
    slug: string,
    chainKey: string,
    walletAddress: string,
    quantity = 1,
  ): Promise<WalletActionResult> {
    let body: { to?: string; data?: string; value?: string } | null = null;
    try {
      const { status, json } = await this.request(
        `/api/v2/drops/${encodeURIComponent(slug)}/mint`,
        { method: 'POST', body: { minter: walletAddress, quantity } },
      );
      if (status === 200 && json?.data && json?.to) {
        body = json as { to: string; data: string; value: string };
        return {
          action: {
            target: body.to as string,
            calldata: body.data as string,
            value: body.value ?? '0',
          },
          reason: null,
        };
      }
      const msg = Array.isArray(json?.errors)
        ? json.errors.join('; ')
        : `OpenSea mint API responded ${status}`;
      return { action: null, reason: msg };
    } catch (err) {
      return { action: null, reason: (err as Error).message };
    }
  }

  /** Resolve a contract address to its OpenSea collection slug. */
  async resolveSlug(address: string, chainKey: string): Promise<string | null> {
    const osChain = CHAIN_MAP[chainKey] ?? chainKey;
    try {
      const { status, json } = await this.request(
        `/api/v2/chain/${osChain}/contract/${address}`,
      );
      if (status === 200 && typeof json?.collection === 'string' && json.collection) {
        return json.collection;
      }
    } catch {
      // ignore
    }
    return null;
  }
}

/** Cheap eligibility probe used by the pre-flight (osnm-z eligibility checker). */
export async function checkEligibility(
  client: OpenSeaApiClient,
  slug: string,
  chainKey: string,
  walletAddress: string,
): Promise<boolean> {
  const { action } = await client.fetchWalletMintAction(slug, chainKey, walletAddress);
  return action !== null;
}
