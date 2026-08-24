export const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
export const TX_HASH_RE = /^0x[a-fA-F0-9]{64}$/;

export function isAddress(value: string): boolean {
  return ADDRESS_RE.test(value);
}

export function isTxHash(value: string): boolean {
  return TX_HASH_RE.test(value);
}

export function shortAddress(address: string, size = 4): string {
  return `${address.slice(0, 2 + size)}...${address.slice(-size)}`;
}

export function shortTx(hash: string): string {
  return `${hash.slice(0, 10)}...${hash.slice(-8)}`;
}

// Accepts a contract address, an OpenSea URL or a bare slug and returns
// { address?, slug?, chainKey? } so the engine can resolve either way.
export function parseCollectionInput(
  input: string,
): { address?: string; slug?: string; chainKey?: string } {
  const value = input.trim();
  if (isAddress(value)) return { address: value.toLowerCase() };

  // https://opensea.io/assets/<chain>/<addr>/<id> or https://opensea.io/item/<chain>/<addr>/<id>
  const assetMatch = value.match(/opensea\.io\/(?:assets|item)\/([a-z0-9-]+)\/(0x[a-f0-9]{40})/i);
  if (assetMatch) {
    return {
      chainKey: assetMatch[1].toLowerCase(),
      address: assetMatch[2].toLowerCase(),
    };
  }

  // https://opensea.io/collection/<slug>
  const colMatch = value.match(/opensea\.io\/collection\/([a-z0-9-]+)/i);
  if (colMatch) {
    return { slug: colMatch[1].toLowerCase() };
  }

  // fallback generic URL match
  const genericMatch = value.match(/opensea\.io\/(?:collection|assets|item)\/([a-z0-9-]+)/i);
  if (genericMatch) {
    const part = genericMatch[1];
    if (isAddress(part)) return { address: part.toLowerCase() };
    return { slug: part.toLowerCase() };
  }

  return { slug: value.toLowerCase() };
}

const GWEI = 1_000_000_000n;

export function gweiToWei(gwei: number): bigint {
  return BigInt(Math.round(gwei * Number(GWEI)));
}

export function weiToGweiString(wei: bigint): string {
  const whole = wei / GWEI;
  const frac = wei % GWEI;
  if (frac === 0n) return whole.toString();
  return `${whole}.${frac.toString().padStart(9, '0').replace(/0+$/, '')}`;
}

export function formatEth(wei: bigint, decimals = 5): string {
  return (Number(wei) / Number(GWEI) / 1e9).toFixed(decimals);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function formatCountdown(msRemaining: number): string {
  if (msRemaining <= 0) return '00:00';
  const total = Math.floor(msRemaining / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
