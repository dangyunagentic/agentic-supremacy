// Minimal JSON-RPC transport that speaks both HTTP(S) and WS(S). Zero runtime
// deps: uses the platform `fetch` for http(s) and the native `WebSocket` global
// (available in Node >= 22 and every browser) for ws(s). Shared by the API
// (latency ping) and the worker (connection warm-up + tx blast) so a chain RPC
// endpoint may be an https:// or a wss:// URL.

export function isWsUrl(url: string): boolean {
  return /^wss?:\/\//i.test(url);
}

export function isHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

export interface JsonRpcResponse {
  id: number;
  jsonrpc: string;
  result?: unknown;
  error?: { code?: number; message?: string };
}

/** Send a single JSON-RPC request over http(s) or ws(s) and resolve the result. */
export function jsonRpcRequest(
  url: string,
  method: string,
  params: unknown[] = [],
  timeoutMs = 8000,
): Promise<unknown> {
  if (isWsUrl(url)) return wsRequest(url, method, params, timeoutMs);
  return httpRequest(url, method, params, timeoutMs);
}

async function httpRequest(
  url: string,
  method: string,
  params: unknown[],
  timeoutMs: number,
): Promise<unknown> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as JsonRpcResponse;
  if (json.error) throw new Error(json.error.message ?? 'JSON-RPC error');
  return json.result;
}

function wsRequest(
  url: string,
  method: string,
  params: unknown[],
  timeoutMs: number,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    // Node >= 22 exposes WebSocket globally; browsers always have it.
    if (typeof WebSocket === 'undefined') {
      reject(new Error('WebSocket is not available in this runtime'));
      return;
    }
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }

    const id = Math.floor(Math.random() * 0x7fffffff);
    let settled = false;

    const finish = (err?: Error, result?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      if (err) reject(err);
      else resolve(result);
    };

    const timer = setTimeout(() => finish(new Error('WebSocket JSON-RPC timeout')), timeoutMs);

    ws.onopen = () => {
      try {
        ws.send(JSON.stringify({ jsonrpc: '2.0', method, params, id }));
      } catch (err) {
        finish(err instanceof Error ? err : new Error(String(err)));
      }
    };

    ws.onmessage = (ev: MessageEvent) => {
      let msg: JsonRpcResponse;
      try {
        msg = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data));
      } catch {
        return;
      }
      if (msg.id !== id) return;
      if (msg.error) {
        finish(new Error(msg.error.message ?? 'JSON-RPC error'));
        return;
      }
      finish(undefined, msg.result);
    };

    ws.onerror = () => finish(new Error('WebSocket transport error'));
    ws.onclose = () => finish(new Error('WebSocket closed before response'));
  });
}
