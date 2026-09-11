// Ported from nft-public-mint/src/connection-warmer.ts.
//
// Pre-establish TCP/TLS to every RPC so the first real request does not pay
// for a handshake. Some endpoints (Base's sequencer, for one) only accept
// requests after they have seen traffic from the connection.

import { formatMs } from './format';
import { jsonRpcRequest } from '@mintbot/shared';

/** Warm connections by sending a harmless request to each endpoint. */
export async function warmConnections(endpoints: string[]): Promise<number> {
  const started = Date.now();
  const body = JSON.stringify({
    jsonrpc: '2.0',
    method: 'eth_sendRawTransaction',
    params: ['0x00'], // intentionally invalid; we only need the handshake
    id: 1,
  });

  await Promise.allSettled(
    endpoints.map((url) => {
      // Warm ws(s) endpoints by opening+pinging; warm http(s) by POSTing a
      // deliberately-invalid sendRawTransaction (only the handshake matters).
      if (/^wss?:\/\//i.test(url)) {
        return jsonRpcRequest(url, 'eth_blockNumber', []).catch(() => undefined);
      }
      return fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      }).catch(() => undefined);
    }),
  );

  return Date.now() - started;
}

export { formatMs };
