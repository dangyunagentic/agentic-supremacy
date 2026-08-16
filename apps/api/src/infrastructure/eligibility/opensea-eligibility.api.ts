import { Inject, Injectable } from '@nestjs/common';
import type { EligibilityApiPort } from '../../domain/ports/ports';
import { TOKENS } from '../../domain/tokens';
import type { KeyEncryptionPort } from '../../domain/ports/ports';
import type { SystemConfigRepository } from '../../domain/repositories/system.repository';

const OPENSEA_GRAPHQL_URL = 'https://api.opensea.io/api/graphql';

/**
 * API-side GTD/FCFS eligibility adapter. Mirrors the worker's OpenSea client
 * but only exposes read-only stage and per-wallet action probes.
 */
@Injectable()
export class OpenSeaEligibilityApi implements EligibilityApiPort {
  private apiKey: string | null | undefined;

  constructor(
    @Inject(TOKENS.SystemConfigRepository) private readonly config: SystemConfigRepository,
    @Inject(TOKENS.KeyEncryption) private readonly crypto: KeyEncryptionPort,
  ) {}

  private async key(): Promise<string | null> {
    if (this.apiKey !== undefined) return this.apiKey;
    const cfg = await this.config.get();
    if (!cfg.openseaApiKeyEnc) {
      this.apiKey = null;
      return null;
    }
    try {
      this.apiKey = this.crypto.decrypt(cfg.openseaApiKeyEnc);
    } catch {
      this.apiKey = null;
    }
    return this.apiKey;
  }

  get configured(): boolean {
    // Async key load means the first call may report false; the use case
    // re-checks after load via fetchStage errors.
    return true;
  }

  private async graphql<T>(query: string, variables: Record<string, string>): Promise<T> {
    const key = await this.key();
    if (!key) throw new Error('OpenSea API key not configured');
    const res = await fetch(OPENSEA_GRAPHQL_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`OpenSea API responded ${res.status}`);
    const json = (await res.json()) as {
      data?: T;
      errors?: Array<{ message?: string }>;
    };
    if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join('; '));
    return json.data as T;
  }

  async fetchStage(slug: string, chainKey: string) {
    const data = await this.graphql<{
      collection?: {
        activeStage?: { __typename?: string; startTime?: string | null; endTime?: string | null };
      };
    }>(
      'query MintStage($slug: String!, $chain: String!) { collection(slug: $slug, chain: $chain) { activeStage { __typename startTime endTime } } }',
      { slug, chain: chainKey },
    );
    const stage = data.collection?.activeStage;
    if (!stage) return { kind: 'none' as const, startTime: null, endTime: null };
    const name = stage.__typename?.toLowerCase() ?? '';
    const kind = name.includes('fcfs')
      ? ('fcfs' as const)
      : name.includes('allow') || name.includes('guaranteed')
        ? ('allowlist' as const)
        : ('public' as const);
    return { kind, startTime: stage.startTime ?? null, endTime: stage.endTime ?? null };
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
