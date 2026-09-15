// Persistent WebSocket pool for zero-handshake blasts.
//
// blastWs() in rpc-blast.ts opens a NEW socket at fire time and pays the full
// TCP+TLS+WS handshake (~400-550ms measured) in the critical moment. This pool
// pre-opens sockets during pre-sign and reuses them: the send at T-0 only pays
// the network round-trip (~97ms measured vs ~550ms cold).
//
// Lifecycle: pool.warm(urls) is called right before signing (T-10s), sockets
// are kept alive with periodic eth_blockNumber pings, and pool.close() is
// called when the engine is destroyed. Sockets are per-URL; a socket that
// drops is lazily re-opened on next use.

export interface PooledResult {
  label: string;
  txHash: string | null;
  ok: boolean;
  message?: string;
}

interface PoolEntry {
  url: string;
  label: string;
  ws: WebSocket | null;
  connecting: Promise<WebSocket> | null;
  lastUse: number;
  reqId: number;
  pending: Map<number, {
    resolve: (v: { result?: string; error?: { message?: string } }) => void;
    timer: ReturnType<typeof setTimeout>;
  }>;
}

const IDLE_PING_MS = 15_000; // keep sockets warm with a ping every 15s
const REQUEST_TIMEOUT_MS = 10_000;

export class WsBlastPool {
  private entries = new Map<string, PoolEntry>();
  private idleTimer: ReturnType<typeof setInterval> | null = null;
  private closed = false;

  /** Pre-open sockets to every wss endpoint. Call during pre-sign (T-10s). */
  async warm(urls: string[]): Promise<number> {
    const started = Date.now();
    const wsUrls = urls.filter((u) => /^wss?:\/\//i.test(u));
    await Promise.allSettled(wsUrls.map((u) => this.connect(u)));
    if (wsUrls.length > 0 && !this.idleTimer) {
      this.idleTimer = setInterval(() => this.pingAll(), IDLE_PING_MS);
      // don't hold the event loop open just for pings
      (this.idleTimer as unknown as { unref?: () => void }).unref?.();
    }
    return Date.now() - started;
  }

  private entry(url: string): PoolEntry {
    let e = this.entries.get(url);
    if (!e) {
      let label = url.slice(0, 24);
      try {
        label = new URL(url).hostname;
      } catch {
        /* keep fallback */
      }
      e = { url, label, ws: null, connecting: null, lastUse: 0, reqId: 0, pending: new Map() };
      this.entries.set(url, e);
    }
    return e;
  }

  private connect(url: string): Promise<WebSocket> {
    const e = this.entry(url);
    if (e.ws && e.ws.readyState === WebSocket.OPEN) return Promise.resolve(e.ws);
    if (e.connecting) return e.connecting;

    e.connecting = new Promise<WebSocket>((resolve, reject) => {
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch (err) {
        e.connecting = null;
        reject(err);
        return;
      }
      const onOpen = () => {
        cleanup();
        e.ws = ws;
        e.connecting = null;
        resolve(ws);
      };
      const onFail = () => {
        cleanup();
        if (e.ws === ws) e.ws = null;
        e.connecting = null;
        reject(new Error('ws connect failed'));
      };
      const cleanup = () => {
        clearTimeout(timer);
        ws.removeEventListener('open', onOpen);
        ws.removeEventListener('error', onFail);
        ws.removeEventListener('close', onFail);
      };
      const timer = setTimeout(onFail, 10_000);
      ws.addEventListener('open', onOpen);
      ws.addEventListener('error', onFail);
      ws.addEventListener('close', onFail);
      // data listener lives for the socket's lifetime
      ws.addEventListener('message', (ev: MessageEvent) => {
        try {
          const json = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data));
          const p = e.pending.get(json.id);
          if (p) {
            e.pending.delete(json.id);
            clearTimeout(p.timer);
            p.resolve(json);
          }
        } catch {
          /* not for us */
        }
      });
    });
    return e.connecting;
  }

  /** JSON-RPC request over a pooled socket. */
  private async request(
    url: string,
    method: string,
    params: unknown[],
    timeoutMs = REQUEST_TIMEOUT_MS,
  ): Promise<{ result?: string; error?: { message?: string } }> {
    if (this.closed) throw new Error('pool closed');
    const e = this.entry(url);
    const ws = await this.connect(url);
    const id = ++e.reqId;
    e.lastUse = Date.now();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        e.pending.delete(id);
        // a timed-out socket is suspect; drop it so the next use reconnects
        if (e.ws === ws) {
          try {
            ws.close();
          } catch {
            /* ignore */
          }
          e.ws = null;
        }
        reject(new Error('ws request timeout'));
      }, timeoutMs);
      e.pending.set(id, { resolve, timer });
      try {
        ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
      } catch (err) {
        e.pending.delete(id);
        clearTimeout(timer);
        reject(err);
      }
    });
  }

  /** Fire a raw pre-serialized eth_sendRawTransaction body over the pool. */
  async blast(url: string, rawTx: string, localTxHash: string): Promise<PooledResult> {
    const e = this.entry(url);
    try {
      const json = await this.request(url, 'eth_sendRawTransaction', [rawTx]);
      if (json.result) {
        return { label: e.label, txHash: json.result, ok: true };
      }
      const message = json.error?.message ?? 'no result';
      if (/already known|already imported|replacement transaction/i.test(message)) {
        return { label: e.label, txHash: localTxHash, ok: true, message: 'already known' };
      }
      return { label: e.label, txHash: null, ok: false, message };
    } catch (err) {
      return { label: e.label, txHash: null, ok: false, message: (err as Error).message };
    }
  }

  private async pingAll() {
    for (const e of this.entries.values()) {
      if (e.ws && e.ws.readyState === WebSocket.OPEN) {
        try {
          await this.request(e.url, 'eth_blockNumber', [], 5000);
        } catch {
          // ping failure closes the socket via request(); next use reconnects
        }
      }
    }
  }

  get size(): number {
    return this.entries.size;
  }

  async close() {
    this.closed = true;
    if (this.idleTimer) clearInterval(this.idleTimer);
    for (const e of this.entries.values()) {
      for (const p of e.pending.values()) {
        clearTimeout(p.timer);
        p.resolve({ error: { message: 'pool closed' } });
      }
      e.pending.clear();
      try {
        e.ws?.close();
      } catch {
        /* ignore */
      }
    }
    this.entries.clear();
  }
}
