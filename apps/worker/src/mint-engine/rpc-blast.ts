// Ported from nft-public-mint/src/rpc-blast.ts.
//
// One method, N endpoints, one shot: a pre-serialised JSON-RPC body is fired
// at every endpoint in parallel and forgotten; the local keccak is the only
// hash that matters (some nodes answer with the sender, not the hash).

import { keccak256 } from 'ethers';
import type { Provider } from 'ethers';

export interface RpcEndpoint {
  url: string;
  label: string;
}

export interface BlastResult {
  label: string;
  txHash: string | null;
  ok: boolean;
  message?: string;
}

export interface PreparedBlast {
  txHash: string;
  body: string;
}

const JSON_RPC_BODY = JSON.stringify({
  jsonrpc: '2.0',
  method: 'eth_sendRawTransaction',
  params: ['__RAW_TX__'],
  id: 1,
});

export function prepareBlast(rawTx: string): PreparedBlast {
  return {
    txHash: keccak256(rawTx),
    body: JSON_RPC_BODY.replace('__RAW_TX__', rawTx),
  };
}

function parseRpcEndpoints(urls: string[]): RpcEndpoint[] {
  return urls.map((url) => {
    try {
      const parsed = new URL(url);
      return { url, label: parsed.hostname };
    } catch {
      return { url, label: url.slice(0, 24) };
    }
  });
}

/**
 * Fire-and-forget dispatch: returns immediately after every fetch is in
 * flight. Responses are collected in the background via allSettled.
 */
export function blastToAll(
  rawTx: string,
  endpoints: string[],
): { txHash: string; responsePromise: Promise<BlastResult[]> } {
  const { txHash, body } = prepareBlast(rawTx);
  const parsed = parseRpcEndpoints(endpoints);

  const firePromises = parsed.map((ep) =>
    fetch(ep.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    }).then(async (res): Promise<BlastResult> => {
      const text = await res.text();
      let json: { result?: string; error?: { message?: string } } | null = null;
      try {
        json = JSON.parse(text);
      } catch {
        return { label: ep.label, txHash: null, ok: false, message: `non-JSON: ${text.slice(0, 80)}` };
      }
      if (json?.result) {
        return { label: ep.label, txHash: json.result, ok: true };
      }
      const message = json?.error?.message ?? text.slice(0, 120);
      // Already-in-mempool counts as accepted.
      if (/already known|already imported|replacement transaction/i.test(message)) {
        return { label: ep.label, txHash, ok: true, message: 'already known' };
      }
      return { label: ep.label, txHash: null, ok: false, message };
    }),
  );

  const responsePromise = Promise.allSettled(firePromises).then((settled) =>
    settled.map((s) =>
      s.status === 'fulfilled'
        ? s.value
        : { label: '?', txHash: null, ok: false, message: String(s.reason).slice(0, 120) },
    ),
  );

  return { txHash, responsePromise };
}

export function anyAccepted(results: BlastResult[]): boolean {
  return results.some((r) => r.ok);
}

/** Polls until mined or timeout. Returns receipt fields or a timeout marker. */
export async function waitForReceipt(
  provider: Provider,
  txHash: string,
  options: { timeoutMs: number; baseMs: number; maxMs: number },
): Promise<
  | { found: true; blockNumber: number | null; status: number; gasUsed: bigint }
  | { found: false }
> {
  const deadline = Date.now() + options.timeoutMs;
  let delay = options.baseMs;

  while (Date.now() < deadline) {
    const receipt = await provider.getTransactionReceipt(txHash);
    if (receipt) {
      return {
        found: true,
        blockNumber: receipt.blockNumber ?? null,
        status: receipt.status ?? 0,
        gasUsed: receipt.gasUsed,
      };
    }
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(options.maxMs, delay * 2);
  }
  return { found: false };
}
