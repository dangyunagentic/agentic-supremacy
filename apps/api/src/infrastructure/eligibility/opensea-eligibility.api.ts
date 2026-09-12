import { Inject, Injectable } from '@nestjs/common';
import type { EligibilityApiPort } from '../../domain/ports/ports';
import { TOKENS } from '../../domain/tokens';
import type { KeyEncryptionPort } from '../../domain/ports/ports';
import type { SystemConfigRepository } from '../../domain/repositories/system.repository';

const OPENSEA_GRAPHQL_URL = 'https://api.opensea.io/api/graphql';

/**
 * API-side GTD/FCFS eligibility adapter. Mirrors the worker's OpenSea client
 * with multi-key rotation and 429 backoff retry.
 */
@Injectable()
export class OpenSeaEligibilityApi implements EligibilityApiPort {
  private apiKeys: string[] | null | undefined;
  private keyIndex = 0;

  constructor(
    @Inject(TOKENS.SystemConfigRepository) private readonly config: SystemConfigRepository,
    @Inject(TOKENS.KeyEncryption) private readonly crypto: KeyEncryptionPort,
  ) {}

  private async keys(): Promise<string[]> {
    if (this.apiKeys !== undefined && this.apiKeys !== null) return this.apiKeys;
    let raw: string | null = null;
    const cfg = await this.config.get();
    if (cfg.openseaApiKeyEnc) {
      try {
        raw = this.crypto.decrypt(cfg.openseaApiKeyEnc);
      } catch {
        raw = null;
      }
    }
    if (!raw) {
      raw = process.env.OPENSEA_API_KEYS || process.env.OPENSEA_API_KEY || null;
    }
    if (!raw) {
      this.apiKeys = [];
      return [];
    }
    this.apiKeys = raw
      .split(/[\n,;]+/)
      .map((k) => k.trim())
      .filter(Boolean);
    return this.apiKeys;
  }

  private async nextKey(): Promise<string> {
    const list = await this.keys();
    if (list.length === 0) throw new Error('OpenSea API key not configured');
    const key = list[this.keyIndex % list.length];
    this.keyIndex = (this.keyIndex + 1) % list.length;
    return key;
  }

  get configured(): boolean {
    return true;
  }

  private async graphql<T>(query: string, variables: Record<string, string>, maxRetries = 3): Promise<T> {
    let attempt = 0;
    while (attempt <= maxRetries) {
      attempt++;
      const key = await this.nextKey();
      try {
        const res = await fetch(OPENSEA_GRAPHQL_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
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
          throw new Error(`OpenSea rate limit reached (HTTP 429) after ${maxRetries} retries`);
        }

        if ((res.status === 502 || res.status === 503 || res.status === 504) && attempt <= maxRetries) {
          await new Promise((r) => setTimeout(r, 250 * attempt));
          continue;
        }

        if (!res.ok) throw new Error(`OpenSea API responded ${res.status}`);
        const json = (await res.json()) as {
          data?: T;
          errors?: Array<{ message?: string }>;
        };
        if (json.errors?.length) {
          const errMsg = json.errors.map((e) => e.message).join('; ');
          if (/rate limit|too many requests|throttl/i.test(errMsg) && attempt <= maxRetries) {
            const jitter = Math.floor(Math.random() * 150);
            const backoffMs = Math.min(3000, Math.floor(300 * Math.pow(2, attempt - 1)) + jitter);
            await new Promise((r) => setTimeout(r, backoffMs));
            continue;
          }
          throw new Error(errMsg);
        }
        return json.data as T;
      } catch (err) {
        if (/not configured/i.test(String(err))) throw err;
        if (attempt <= maxRetries) {
          await new Promise((r) => setTimeout(r, 250 * attempt));
          continue;
        }
        throw err;
      }
    }
    throw new Error('OpenSea request failed after retries');
  }

  async fetchStage(slug: string, chainKey: string) {
    const data = await this.graphql<{
      collection?: {
        activeStage?: { __typename?: string; name?: string | null; startTime?: string | null; endTime?: string | null };
      };
    }>(
      'query MintStage($slug: String!, $chain: String!) { collection(slug: $slug, chain: $chain) { activeStage { __typename name startTime endTime } } }',
      { slug, chain: chainKey },
    );
    const stage = data.collection?.activeStage;
    if (!stage) return { kind: 'none' as const, startTime: null, endTime: null, name: null };
    const raw = `${stage.__typename ?? ''} ${stage.name ?? ''}`.toLowerCase();
    const kind = raw.includes('fcfs') || raw.includes('first come')
      ? ('fcfs' as const)
      : raw.includes('allow') || raw.includes('gtd') || raw.includes('list') || raw.includes('guaranteed')
        ? ('allowlist' as const)
        : raw.includes('public')
          ? ('public' as const)
          : ('fcfs' as const);
    return { kind, startTime: stage.startTime ?? null, endTime: stage.endTime ?? null, name: stage.name ?? null };
  }

  async fetchWalletAction(slug: string, chainKey: string, address: string) {
    try {
      const data = await this.graphql<{
        collection?: {
          activeStage?: {
            actions?: Array<{ __typename?: string; calldata?: string }>;
          };
        };
      }>(
        'query WalletMintAction($slug: String!, $chain: String!, $address: String!) { collection(slug: $slug, chain: $chain) { activeStage { actions(address: $address) { __typename calldata } } } }',
        { slug, chain: chainKey, address },
      );
      const action = data.collection?.activeStage?.actions?.find((a) => a.calldata);
      if (!action) return { eligible: false, reason: 'No signed mint action for this wallet' };
      return { eligible: true, reason: 'Wallet has a signed GTD/FCFS mint action' };
    } catch (err) {
      return { eligible: false, reason: `Check failed: ${(err as Error).message}` };
    }
  }
}
