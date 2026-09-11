import { Injectable, Logger } from '@nestjs/common';
import type { SocialExecutorPort } from '../../domain/ports/ports';
import { proxyFetch } from './proxy-fetch';

/**
 * Executes off-chain social/automation actions. Every HTTP call routes through
 * the account's proxy (or the run-level override) so the target sees the proxy
 * IP, not the VPS IP. Supports http(s)/socks5 proxies.
 *
 * Supported actions:
 *   - x_follow / x_unfollow / x_reply / x_repost
 *   - form_submit   (Google Forms / generic form)
 *   - wallet_submit (custom wallet submission endpoint)
 *   - captcha_solve (route to configured solver; token session-bound)
 *   - validate       (credential + proxy connectivity check)
 */

interface Credentials {
  authToken?: string; // X bearer token
  cookies?: string; // raw cookie header
  csrf?: string; // X ct0 token
  apiKey?: string; // generic API key for custom endpoints
  captchaSolverUrl?: string;
  captchaSolverKey?: string;
}

@Injectable()
export class SocialExecutor implements SocialExecutorPort {
  private readonly logger = new Logger(SocialExecutor.name);

  private parseCreds(credentials: string): Credentials {
    try {
      return JSON.parse(credentials) as Credentials;
    } catch {
      return {};
    }
  }

  private mask(s: string | undefined | null): string {
    if (!s) return '';
    return s.length <= 6 ? '****' : `${s.slice(0, 3)}…${s.slice(-3)}`;
  }

  async validateConnection(
    platform: string,
    credentials: string,
    proxy: string | null,
  ): Promise<{ ok: boolean; detail?: string }> {
    const creds = this.parseCreds(credentials);
    try {
      switch (platform) {
        case 'x': {
          if (!creds.authToken && !creds.cookies) {
            return { ok: false, detail: 'Missing X auth token or cookies' };
          }
          const url = 'https://api.x.com/1.1/account/verify_credentials.json';
          const headers: Record<string, string> = { 'user-agent': this.ua() };
          if (creds.authToken) headers.authorization = `Bearer ${creds.authToken}`;
          if (creds.cookies) headers.cookie = creds.cookies;
          if (creds.csrf) headers['x-csrf-token'] = creds.csrf;
          const res = await proxyFetch(url, proxy, { headers, timeoutMs: 12000 });
          return res.status === 200
            ? { ok: true }
            : { ok: false, detail: `X returned HTTP ${res.status}` };
        }
        case 'gmail': {
          if (!creds.cookies && !creds.apiKey) {
            return { ok: false, detail: 'Missing Gmail credentials' };
          }
          const res = await proxyFetch('https://mail.google.com/mail/u/0/', proxy, {
            headers: {
              'user-agent': this.ua(),
              ...(creds.cookies ? { cookie: creds.cookies } : {}),
            },
            timeoutMs: 12000,
          });
          return res.status < 400
            ? { ok: true }
            : { ok: false, detail: `Gmail returned HTTP ${res.status}` };
        }
        case 'discord': {
          if (!creds.apiKey) return { ok: false, detail: 'Missing Discord token' };
          const res = await proxyFetch('https://discord.com/api/v10/users/@me', proxy, {
            headers: { authorization: creds.apiKey, 'user-agent': this.ua() },
            timeoutMs: 12000,
          });
          if (res.status === 200) {
            const j = await res.json<{ username?: string }>();
            return { ok: true, detail: j.username ? `connected as ${j.username}` : 'connected' };
          }
          return { ok: false, detail: `Discord returned HTTP ${res.status}` };
        }
        default:
          return { ok: false, detail: `Unsupported platform: ${platform}` };
      }
    } catch (e) {
      return { ok: false, detail: (e as Error).message };
    }
  }

  async execute(
    action: string,
    credentials: string,
    proxy: string | null,
    input: unknown,
  ): Promise<{ ok: boolean; detail?: string; output?: unknown }> {
    const creds = this.parseCreds(credentials);
    try {
      switch (action) {
        case 'x_follow':
          return await this.xFollow(creds, proxy, input);
        case 'x_unfollow':
          return await this.xUnfollow(creds, proxy, input);
        case 'x_reply':
          return await this.xReply(creds, proxy, input);
        case 'x_repost':
          return await this.xRepost(creds, proxy, input);
        case 'form_submit':
          return await this.formSubmit(creds, proxy, input);
        case 'wallet_submit':
          return await this.walletSubmit(creds, proxy, input);
        case 'captcha_solve':
          return await this.captchaSolve(creds, proxy, input);
        case 'validate':
          return this.validateConnection('x', credentials, proxy);
        default:
          return { ok: false, detail: `Unsupported action: ${action}` };
      }
    } catch (e) {
      this.logger.warn(`${action} failed: ${(e as Error).message}`);
      return { ok: false, detail: (e as Error).message };
    }
  }

  private ua(): string {
    return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
  }

  private asUserId(input: unknown): string {
    const o = (input ?? {}) as Record<string, any>;
    return String(o.userId ?? o.username ?? o.target ?? '');
  }

  // ---- X (Twitter) actions ------------------------------------------------

  private async xFollow(creds: Credentials, proxy: string | null, input: unknown) {
    const userId = this.asUserId(input);
    if (!userId) return { ok: false, detail: 'Missing target userId/username' };
    return this.xGraphql(creds, proxy, 'follow_unfollow', {
      '1/1.1.0': { userId, act: 'follow' },
    });
  }

  private async xUnfollow(creds: Credentials, proxy: string | null, input: unknown) {
    const userId = this.asUserId(input);
    if (!userId) return { ok: false, detail: 'Missing target userId/username' };
    return this.xGraphql(creds, proxy, 'follow_unfollow', {
      '1/1.1.0': { userId, act: 'unfollow' },
    });
  }

  private async xReply(creds: Credentials, proxy: string | null, input: unknown) {
    const o = (input ?? {}) as Record<string, any>;
    const tweetId = String(o.tweetId ?? '');
    const text = String(o.text ?? '');
    if (!tweetId || !text) return { ok: false, detail: 'Missing tweetId or text' };
    const url = 'https://api.x.com/1.1/statuses/update.json';
    const headers: Record<string, string> = { 'user-agent': this.ua(), 'content-type': 'application/x-www-form-urlencoded' };
    if (creds.authToken) headers.authorization = `Bearer ${creds.authToken}`;
    if (creds.cookies) headers.cookie = creds.cookies;
    if (creds.csrf) headers['x-csrf-token'] = creds.csrf;
    const body = new URLSearchParams({ status: text, in_reply_to_status_id: tweetId, auto_populate_reply_metadata: 'true' }).toString();
    const res = await proxyFetch(url, proxy, { method: 'POST', headers, body });
    const out = res.status < 300 ? { id: await this.extractId(res) } : undefined;
    return { ok: res.status < 300, detail: `HTTP ${res.status}`, output: out };
  }

  private async xRepost(creds: Credentials, proxy: string | null, input: unknown) {
    const tweetId = String((input as any)?.tweetId ?? '');
    if (!tweetId) return { ok: false, detail: 'Missing tweetId' };
    const url = `https://api.x.com/1.1/statuses/retweet/${tweetId}.json`;
    const headers: Record<string, string> = { 'user-agent': this.ua() };
    if (creds.authToken) headers.authorization = `Bearer ${creds.authToken}`;
    if (creds.cookies) headers.cookie = creds.cookies;
    if (creds.csrf) headers['x-csrf-token'] = creds.csrf;
    const res = await proxyFetch(url, proxy, { method: 'POST', headers });
    return { ok: res.status < 300, detail: `HTTP ${res.status}` };
  }

  private async xGraphql(
    creds: Credentials,
    proxy: string | null,
    opName: string,
    variables: Record<string, unknown>,
  ) {
    const features = {
      responsive_web_graphql_exclude_directive_enabled: true,
      verified_phone_label_enabled: false,
      highlights_tweets_tab_ui_enabled: true,
      creator_subscriptions_tweet_preview_api_enabled: true,
      hidden_profile_likes_enabled: true,
      hidden_profile_subscriptions_enabled: true,
      rweb_tipjar_consumption_enabled: true,
      responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
      responsive_web_graphql_timeline_navigation_enabled: true,
      tweetypie_unmention_optimization_enabled: true,
    };
    const queryId = 'V3d7pWDDH7YupgB1kRVV6w';
    const url = `https://x.com/i/api/graphql/${queryId}/${opName}`;
    const headers: Record<string, string> = {
      'user-agent': this.ua(),
      'content-type': 'application/json',
      authorization: `Bearer ${creds.authToken ?? ''}`,
    };
    if (creds.cookies) headers.cookie = creds.cookies;
    if (creds.csrf) headers['x-csrf-token'] = creds.csrf;
    const body = JSON.stringify({ variables, features, queryId });
    const res = await proxyFetch(url, proxy, { method: 'POST', headers, body });
    return { ok: res.status < 300, detail: `HTTP ${res.status}` };
  }

  private async extractId(res: { json<T>(): Promise<T> }): Promise<string> {
    try {
      const j = (await res.json()) as any;
      return String(j?.id_str ?? j?.id ?? j?.data?.create_tweet?.tweet_results?.result?.rest_id ?? '');
    } catch {
      return '';
    }
  }

  // ---- Generic form / wallet submissions ----------------------------------

  private async formSubmit(creds: Credentials, proxy: string | null, input: unknown) {
    const o = (input ?? {}) as Record<string, any>;
    const url = String(o.url ?? '');
    const fields = (o.fields ?? {}) as Record<string, unknown>;
    if (!url) return { ok: false, detail: 'Missing form URL' };
    // Google Forms: entry.<id> fields -> convert
    const isGoogleForm = /docs\.google\.com\/forms/.test(url);
    const bodyParams = isGoogleForm ? this.googleFormBody(fields) : fields;
    const method = String(o.method ?? 'POST').toUpperCase();
    const contentType = String(o.contentType ?? (isGoogleForm ? 'application/x-www-form-urlencoded' : 'application/json'));
    const headers: Record<string, string> = {
      'user-agent': this.ua(),
      ...(creds.cookies ? { cookie: creds.cookies } : {}),
      ...(creds.apiKey ? { authorization: `Bearer ${creds.apiKey}` } : {}),
      ...(o.headers ?? {}),
    };
    let body: string;
    if (contentType.includes('json')) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(bodyParams);
    } else {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(bodyParams as Record<string, string>).toString();
    }
    const res = await proxyFetch(url, proxy, { method, headers, body });
    return { ok: res.status < 400, detail: `HTTP ${res.status}` };
  }

  private googleFormBody(fields: Record<string, unknown>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(fields)) {
      // Accept both raw entry ids and readable keys prefixed with entry.
      const key = k.startsWith('entry.') ? k : `entry.${k}`;
      out[key] = String(v);
    }
    return out;
  }

  private async walletSubmit(creds: Credentials, proxy: string | null, input: unknown) {
    const o = (input ?? {}) as Record<string, any>;
    const url = String(o.url ?? '');
    const wallet = String(o.wallet ?? o.address ?? '');
    if (!url || !wallet) return { ok: false, detail: 'Missing url or wallet address' };
    const fieldName = String(o.fieldName ?? 'wallet');
    return this.formSubmit(creds, proxy, { ...o, url, fields: { [fieldName]: wallet, ...(o.fields ?? {}) } });
  }

  private async captchaSolve(creds: Credentials, proxy: string | null, input: unknown) {
    const o = (input ?? {}) as Record<string, any>;
    const siteKey = String(o.siteKey ?? '');
    const pageUrl = String(o.pageUrl ?? '');
    const solverUrl = String(creds.captchaSolverUrl ?? o.solverUrl ?? '');
    const solverKey = String(creds.captchaSolverKey ?? o.solverKey ?? '');
    if (!solverUrl) return { ok: false, detail: 'No captcha solver URL configured' };
    if (!siteKey) return { ok: false, detail: 'Missing siteKey' };
    const body = JSON.stringify({
      sitekey: siteKey,
      pageurl: pageUrl,
      proxy: proxy ?? undefined,
      key: solverKey,
    });
    const res = await proxyFetch(solverUrl, null, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(solverKey ? { authorization: `Bearer ${solverKey}` } : {}) },
      body,
    });
    const out = res.status < 400 ? await res.json().catch(() => ({})) : undefined;
    return { ok: res.status < 400, detail: `HTTP ${res.status}`, output: out };
  }
}
