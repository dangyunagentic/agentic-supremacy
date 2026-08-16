// Ported from nft-public-mint/src/timer.ts.
//
// Sleep until T-minus, then spin: setTimeout alone only guarantees timing at
// ~1ms granularity and can fire early, so the final stretch busy-waits for
// sub-millisecond precision. Early-fire leaves room for network travel.

export interface CountdownEntry {
  label: string;
  at: Date;
}

export async function waitForMintTime(mintTime: Date, earlyFireMs = 0): Promise<void> {
  const fireTime = new Date(mintTime.getTime() - earlyFireMs);
  const diff = fireTime.getTime() - Date.now();

  if (diff <= 0) return;

  // Long wait: plain setTimeout, waking 100ms before the target.
  if (diff > 10_000) {
    await new Promise((resolve) => setTimeout(resolve, diff - 100));
  }

  // Spin-wait the final stretch (busy loop; ~5-50us precision).
  // eslint-disable-next-line no-empty
  while (Date.now() < fireTime.getTime()) {}
}
