export function formatMs(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`;
}

export function short(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}
