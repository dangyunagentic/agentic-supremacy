// Minimal proxy-aware HTTP client built on Node's http/https/net/tls modules.
// Supports http:// and https:// proxies via the CONNECT method, plus socks5://
// via a bare SOCKS5 handshake. Zero external dependencies — the runtime's
// `fetch` (undici) does NOT route through a proxy, so this is a drop-in
// replacement for proxy-required requests (form/wallet submissions, X actions,
// captcha solving).

import { request as httpRequest } from 'http';
import { request as httpsRequest } from 'https';
import { connect } from 'net';
import * as tls from 'tls';

export interface ProxyFetchResponse {
  status: number;
  headers: Record<string, string>;
  text(): Promise<string>;
  json<T = unknown>(): Promise<T>;
}

export interface ProxyConfig {
  proxyUrl: string | null;
  timeoutMs?: number;
}

export function isProxyUrl(url: string): boolean {
  return /^(https?|socks5|socks4):\/\//i.test(url);
}

export function parseProxy(url: string): {
  protocol: string;
  host: string;
  port: number;
  auth?: string;
} {
  const m = url.match(/^(https?|socks5|socks4):\/\/(?:([^@]+)@)?([^:]+):(\d+)/i);
  if (!m) throw new Error('Invalid proxy URL');
  return {
    protocol: m[1].toLowerCase(),
    host: m[3],
    port: Number(m[4]),
    auth: m[2],
  };
}

/** Resolve an optional proxy string to a parsed config, or null. */
export function resolveProxy(proxy: string | null | undefined): ProxyConfig {
  if (!proxy || !proxy.trim()) return { proxyUrl: null };
  return { proxyUrl: proxy.trim() };
}

export async function proxyFetch(
  url: string,
  proxy: string | null | undefined,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    timeoutMs?: number;
  } = {},
): Promise<ProxyFetchResponse> {
  const target = new URL(url);
  const method = options.method ?? 'GET';
  const headers = { ...(options.headers ?? {}) };
  const body = options.body ?? null;
  const timeoutMs = options.timeoutMs ?? 15000;

  // Single-shot client: force close so the response stream terminates and
  // `end` fires (we don't implement keep-alive reuse on raw sockets).
  if (!Object.keys(headers).some((k) => k.toLowerCase() === 'connection')) {
    headers['connection'] = 'close';
  }

  if (body && !headers['content-length']) {
    headers['content-length'] = Buffer.byteLength(body).toString();
  }

  if (!proxy || !proxy.trim()) {
    return directFetch(target, method, headers, body, timeoutMs);
  }

  const p = parseProxy(proxy);
  if (p.protocol === 'socks5' || p.protocol === 'socks4') {
    return socksFetch(target, p, method, headers, body, timeoutMs);
  }

  return connectProxyFetch(target, p, method, headers, body, timeoutMs);
}

async function directFetch(
  target: URL,
  method: string,
  headers: Record<string, string>,
  body: string | null,
  timeoutMs: number,
): Promise<ProxyFetchResponse> {
  const isTls = target.protocol === 'https:';
  const transport = isTls ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const r = transport(
      {
        method,
        host: target.hostname,
        port: target.port ? Number(target.port) : isTls ? 443 : 80,
        path: target.pathname + target.search,
        headers: { ...headers, host: target.host },
        servername: isTls ? target.hostname : undefined,
      } as any,
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          resolve({
            status: res.statusCode ?? 0,
            headers: (res.headers ?? {}) as Record<string, string>,
            text: async () => raw,
            json: async <T>() => JSON.parse(raw) as T,
          });
        });
      },
    );
    r.setTimeout(timeoutMs, () => r.destroy(new Error('timeout')));
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

async function connectProxyFetch(
  target: URL,
  proxy: { host: string; port: number; auth?: string },
  method: string,
  headers: Record<string, string>,
  body: string | null,
  timeoutMs: number,
): Promise<ProxyFetchResponse> {
  const isTls = target.protocol === 'https:';
  const targetPort = target.port ? Number(target.port) : isTls ? 443 : 80;
  const proxyPort = proxy.port || 8080;

  return new Promise((resolve, reject) => {
    const socket = connect({ host: proxy.host, port: proxyPort });
    socket.setTimeout(timeoutMs, () => socket.destroy(new Error('proxy timeout')));
    socket.on('error', reject);

    socket.on('connect', () => {
      if (isTls) {
        const auth = proxy.auth ? `Proxy-Authorization: Basic ${Buffer.from(proxy.auth).toString('base64')}\r\n` : '';
        socket.write(
          `CONNECT ${target.hostname}:${targetPort} HTTP/1.1\r\nHost: ${target.hostname}:${targetPort}\r\n${auth}\r\n`,
        );
        let buf = '';
        socket.on('data', function onData(chunk: Buffer) {
          buf += chunk.toString('utf8');
          const idx = buf.indexOf('\r\n\r\n');
          if (idx === -1) return;
          const statusLine = buf.slice(0, idx).split('\r\n')[0];
          const code = Number(statusLine.split(' ')[1]);
          if (code !== 200) {
            socket.destroy();
            reject(new Error(`Proxy CONNECT failed: ${statusLine}`));
            return;
          }
          socket.removeListener('data', onData);
          const secure = tls.connect({ socket, servername: target.hostname });
          secure.on('error', reject);
          secure.on('secureConnect', () => {
            finishOnSocket(secure, target, method, headers, body, timeoutMs).then(resolve, reject);
          });
        });
      } else {
        const auth = proxy.auth ? `Proxy-Authorization: Basic ${Buffer.from(proxy.auth).toString('base64')}\r\n` : '';
        const absPath = `${target.protocol}//${target.host}${target.pathname}${target.search}`;
        const reqHeaders = { ...headers, host: target.host };
        const reqLine = `${method} ${absPath} HTTP/1.1\r\nHost: ${target.host}\r\n${auth}`;
        let hdr = reqLine;
        for (const [k, v] of Object.entries(reqHeaders)) hdr += `${k}: ${v}\r\n`;
        hdr += '\r\n';
        socket.write(hdr);
        if (body) socket.write(body);
        finishOnSocket(socket, target, method, reqHeaders, body, timeoutMs, true).then(resolve, reject);
      }
    });
  });
}

function finishOnSocket(
  socket: NodeJS.Socket,
  target: URL,
  method: string,
  headers: Record<string, string>,
  body: string | null,
  timeoutMs: number,
  alreadySent = false,
): Promise<ProxyFetchResponse> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let headerBuf = '';
    let headersDone = false;
    let status = 0;
    let resHeaders: Record<string, string> = {};
    let contentLength = -1;
    let bodyBytes = 0;
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      let raw = Buffer.concat(chunks).toString('utf8');
      const te = (resHeaders['transfer-encoding'] ?? '').toLowerCase();
      if (te.includes('chunked')) raw = dechunk(raw);
      resolve({
        status,
        headers: resHeaders,
        text: async () => raw,
        json: async <T>() => JSON.parse(raw) as T,
      });
    };

    // If the request hasn't been written yet (e.g. after a TLS upgrade on a
    // CONNECT tunnel), send it in origin-form now.
    if (!alreadySent) {
      let hdr = `${method} ${target.pathname}${target.search} HTTP/1.1\r\nHost: ${target.host}\r\n`;
      for (const [k, v] of Object.entries(headers)) {
        if (k.toLowerCase() === 'host') continue;
        hdr += `${k}: ${v}\r\n`;
      }
      hdr += '\r\n';
      socket.write(hdr);
      if (body) socket.write(body);
    }

    socket.on('data', (c: Buffer) => {
      if (!headersDone) {
        headerBuf += c.toString('utf8');
        const idx = headerBuf.indexOf('\r\n\r\n');
        if (idx !== -1) {
          headersDone = true;
          const headRaw = headerBuf.slice(0, idx);
          const lines = headRaw.split('\r\n');
          status = Number((lines[0].match(/ (\d{3}) /) ?? [])[1] ?? 0);
          for (const ln of lines.slice(1)) {
            const ci = ln.indexOf(':');
            if (ci > 0) resHeaders[ln.slice(0, ci).trim().toLowerCase()] = ln.slice(ci + 1).trim();
          }
          const cl = resHeaders['content-length'];
          if (cl) contentLength = parseInt(cl, 10);
          // Body begins at idx+4 within the accumulated headerBuf.
          const bodyStart = idx + 4;
          if (bodyStart < headerBuf.length) {
            const first = Buffer.from(headerBuf.slice(bodyStart), 'utf8');
            chunks.push(first);
            bodyBytes += first.length;
          }
          maybeFinish();
          return;
        }
        return;
      }
      chunks.push(c);
      bodyBytes += c.length;
      maybeFinish();
    });

    function maybeFinish() {
      if (!headersDone) return;
      const te = (resHeaders['transfer-encoding'] ?? '').toLowerCase();
      if (te.includes('chunked')) {
        // Finished when the accumulated raw body ends with the 0-length chunk
        // terminator ("0\r\n\r\n").
        if (Buffer.concat(chunks).toString('utf8').endsWith('0\r\n\r\n')) {
          finish();
        }
        return;
      }
      if (contentLength >= 0 && bodyBytes >= contentLength) {
        finish();
      }
    }

    socket.on('end', finish);
    socket.on('error', reject);
    socket.on('close', () => {
      if (!headersDone) reject(new Error('socket closed before response'));
      else if (!settled) finish();
    });
  });
}

function dechunk(raw: string): string {
  let out = '';
  let pos = 0;
  while (pos < raw.length) {
    const lineEnd = raw.indexOf('\r\n', pos);
    if (lineEnd === -1) break;
    const sizeHex = raw.slice(pos, lineEnd).trim();
    const size = parseInt(sizeHex, 16);
    if (Number.isNaN(size) || size === 0) break;
    const dataStart = lineEnd + 2;
    out += raw.slice(dataStart, dataStart + size);
    pos = dataStart + size + 2;
  }
  return out;
}

async function socksFetch(
  target: URL,
  proxy: { host: string; port: number; auth?: string },
  method: string,
  headers: Record<string, string>,
  body: string | null,
  timeoutMs: number,
): Promise<ProxyFetchResponse> {
  const isTls = target.protocol === 'https:';
  const targetPort = target.port ? Number(target.port) : isTls ? 443 : 80;
  const proxyPort = proxy.port || 1080;

  return new Promise((resolve, reject) => {
    const socket = connect({ host: proxy.host, port: proxyPort });
    socket.setTimeout(timeoutMs, () => socket.destroy(new Error('socks timeout')));
    socket.on('error', reject);

    socket.on('connect', () => {
      const userpass = proxy.auth ? proxy.auth.split(':') : null;
      const greeting = Buffer.from([0x05, userpass ? 0x02 : 0x01, 0x00, ...(userpass ? [0x02] : [])]);
      socket.write(greeting);

      let stage = 0;
      const onData = (chunk: Buffer) => {
        if (stage === 0) {
          if (chunk[1] === 0xff) return reject(new Error('socks: no acceptable auth'));
          stage = 1;
          if (chunk[1] === 0x02) {
            const u = userpass?.[0] ?? '';
            const p = userpass?.[1] ?? '';
            const authBuf = Buffer.concat([
              Buffer.from([0x01, u.length]),
              Buffer.from(u),
              Buffer.from([p.length]),
              Buffer.from(p),
            ]);
            socket.write(authBuf);
            return;
          }
          sendConnect();
        } else if (stage === 1) {
          if (chunk[1] !== 0x00) return reject(new Error('socks auth failed'));
          stage = 2;
          sendConnect();
        } else if (stage === 2) {
          if (chunk[1] !== 0x00) return reject(new Error('socks connect failed'));
          socket.removeListener('data', onData);
          if (isTls) {
            const secure = tls.connect({ socket, servername: target.hostname });
            secure.on('error', reject);
            secure.on('secureConnect', () => {
              finishOnSocket(secure, target, method, headers, body, timeoutMs).then(resolve, reject);
            });
          } else {
            const reqHeaders = { ...headers, host: target.host };
            const reqLine = `${method} ${target.pathname}${target.search} HTTP/1.1\r\nHost: ${target.host}\r\n`;
            let hdr = reqLine;
            for (const [k, v] of Object.entries(reqHeaders)) hdr += `${k}: ${v}\r\n`;
            hdr += '\r\n';
            socket.write(hdr);
            if (body) socket.write(body);
            finishOnSocket(socket, target, method, reqHeaders, body, timeoutMs, true).then(resolve, reject);
          }
        }
      };

      function sendConnect() {
        const atyp = 0x03;
        const hostBuf = Buffer.from(target.hostname);
        const req = Buffer.concat([
          Buffer.from([0x05, 0x01, 0x00, atyp, hostBuf.length]),
          hostBuf,
          Buffer.from([(targetPort >> 8) & 0xff, targetPort & 0xff]),
        ]);
        socket.write(req);
      }

      socket.on('data', onData);
    });
  });
}
