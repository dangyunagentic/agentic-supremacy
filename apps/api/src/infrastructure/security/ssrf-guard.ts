import { isIP } from 'net';
import { lookup } from 'dns/promises';

// SSRF guard: refuse URLs that resolve to private / loopback / link-local /
// reserved address space. Applied to every user-supplied URL the API fetches
// server-side (RPC endpoint creation + ping).

const BLOCKED_V4 = [
  /^0\./,
  /^10\./,
  /^100\.64\./, // CGNAT
  /^127\./,
  /^169\.254\./, // link-local incl. cloud metadata 169.254.169.254
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
  /^192\.0\.0\./,
  /^192\.0\.2\./, // TEST-NET-1
  /^192\.168\./,
  /^198\.18\./,
  /^198\.51\.100\./, // TEST-NET-2
  /^203\.0\.113\./, // TEST-NET-3
  /^224\./, // multicast
  /^240\./, // reserved
];

function isBlockedIpv4(ip: string): boolean {
  return BLOCKED_V4.some((re) => re.test(ip));
}

function isBlockedIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === '::' || normalized === '::1') return true; // unspecified / loopback
  if (normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) {
    return true; // link-local
  }
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true; // unique local (ULA)
  return false;
}

function isBlockedIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return isBlockedIpv4(ip);
  if (v === 6) return isBlockedIpv6(ip);
  return true; // not an IP → treat as unsafe
}

/** Parse host from a URL string, stripping brackets for IPv6 literals. */
function hostOf(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, '');
}

/**
 * Resolve a URL and throw if any of its resolved addresses fall in blocked
 * private/reserved ranges. Re-checks on every call (no caching) so DNS-rebinding
 * windows are kept minimal; the ping path also re-validates immediately before fetch.
 */
export async function assertSafePublicUrl(rawUrl: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('Invalid URL');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http(s) URLs are allowed');
  }

  const host = hostOf(url);

  // Literal IP in the URL (no DNS needed).
  if (isIP(host) !== 0) {
    if (isBlockedIp(host)) {
      throw new Error('URL resolves to a blocked (non-public) address');
    }
    return;
  }

  // Hostname: resolve all addresses and reject if ANY is private. This closes
  // the classic DNS-rebinding hole where the first lookup is public but a later
  // one returns a private address.
  let addresses: { address: string }[];
  try {
    addresses = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new Error('Could not resolve URL hostname');
  }

  if (addresses.length === 0) throw new Error('URL hostname resolved to no addresses');
  for (const { address } of addresses) {
    if (isBlockedIp(address)) {
      throw new Error('URL resolves to a blocked (non-public) address');
    }
  }
}
