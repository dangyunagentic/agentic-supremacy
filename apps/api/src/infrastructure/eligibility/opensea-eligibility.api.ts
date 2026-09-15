import { Inject, Injectable } from '@nestjs/common';
import type { EligibilityApiPort } from '../../domain/ports/ports';
import { TOKENS } from '../../domain/tokens';
import type { KeyEncryptionPort } from '../../domain/ports/ports';
import type { SystemConfigRepository } from '../../domain/repositories/system.repository';

const OPENSEA_API_BASE = 'https://api.opensea.io';

/**
 * API-side GTD/FCFS eligibility adapter backed by the OpenSea Drops v2 REST
 * API. Mirrors the worker's OpenSea client with multi-key rotation and
 * 429 backoff retry.
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

  private async request(
    path: string,
    init: { method?: string; body?: unknown } = {},
    maxRetries = 3,
  ): Promise<{ status: number; json: any }> {
    let attempt = 0;
    while (true) {
      attempt++;
      const key = await this.nextKey();
      try {
        const res = await fetch(`${OPENSEA_API_BASE}${path}`, {
          method: init.method ?? 'GET',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            'x-api-key': key,
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
          throw new Error(`OpenSea API responded ${res.status} after ${maxRetries} retries`);
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
        if (/not configured/i.test(String(err))) throw err;
        if (attempt <= maxRetries) {
          await new Promise((r) => setTimeout(r, 250 * attempt));
          continue;
        }
        throw err;
      }
    }
  }

  async fetchStage(slug: string, _chainKey?: string) {
    const { status, json } = await this.request(`/api/v2/drops/${encodeURIComponent(slug)}`);
    if (status === 404) return { kind: 'none' as const, startTime: null, endTime: null, name: null };
    if (status !== 200) {
      const msg = json?.errors?.join?.('; ') ?? `OpenSea drops API responded ${status}`;
      throw new Error(msg);
    }
    const drop = json as {
      is_minting?: boolean;
      active_stage?: { stage_type?: string; label?: string | null; start_time?: string | null; end_time?: string | null } | null;
      next_stage?: { stage_type?: string; label?: string | null; start_time?: string | null; end_time?: string | null } | null;
    };
    const stage = drop.is_minting && drop.active_stage ? drop.active_stage : drop.next_stage;
    if (!stage || !stage.start_time) {
      return { kind: 'none' as const, startTime: null, endTime: null, name: null };
    }
    const raw = `${stage.stage_type ?? ''} ${stage.label ?? ''}`.toLowerCase();
    const kind = raw.includes('public')
      ? ('public' as const)
      : raw.includes('fcfs') || raw.includes('first come')
        ? ('fcfs' as const)
        : ('allowlist' as const);
    return {
      kind,
      startTime: stage.start_time,
      endTime: stage.end_time ?? null,
      name: stage.label ?? null,
    };
  }

  async fetchWalletAction(slug: string, _chainKey: string, address: string) {
    try {
      const { status, json } = await this.request(
        `/api/v2/drops/${encodeURIComponent(slug)}/mint`,
        { method: 'POST', body: { minter: address, quantity: 1 } },
      );
      if (status === 200 && json?.data && json?.to) {
        return { eligible: true, reason: 'Wallet has a signed GTD/FCFS mint action' };
      }
      const msg = Array.isArray(json?.errors)
        ? json.errors.join('; ')
        : `No signed mint action (HTTP ${status})`;
      return { eligible: false, reason: msg };
    } catch (err) {
      return { eligible: false, reason: `Check failed: ${(err as Error).message}` };
    }
  }
}
