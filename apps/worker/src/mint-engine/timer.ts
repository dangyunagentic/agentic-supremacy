// Ported from nft-public-mint/src/timer.ts.
//
// Sleep until T-minus, then spin: setTimeout alone only guarantees timing at
// ~1ms granularity and can fire early, so the final stretch busy-waits for
// sub-millisecond precision. Early-fire leaves room for network travel.
//
// Chain clock sync: on-chain stage gates use block timestamps, which can
// drift from the local wall clock. We sample the latest block timestamp and
// compute an offset so we fire when the CHAIN says the stage is open, not
// when the local clock guesses it is.

import type { Provider } from 'ethers';

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

/**
 * Sample the latest block timestamp and compute the offset between on-chain
 * time and local wall-clock time (chainSeconds - localSeconds). Positive
 * means the chain is ahead of local time.
 */
export async function chainClockOffset(provider: Provider): Promise<number> {
  try {
    const block = await provider.getBlock('latest');
    if (!block) return 0;
    return block.timestamp - Math.floor(Date.now() / 1000);
  } catch {
    return 0;
  }
}

/**
 * Wait until the chain's own timestamp reaches targetSec. Uses the sampled
 * clock offset so we fire exactly when the chain opens the stage, even if the
 * local clock drifts. Bounded by timeoutMs.
 */
export async function waitForChainTime(
  provider: Provider,
  targetSec: number,
  timeoutMs = 30_000,
  pollMs = 100,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let offset = await chainClockOffset(provider);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const nowSec = Math.floor(Date.now() / 1000) + offset;
    if (nowSec >= targetSec) return;

    // Re-sample the offset periodically so drift is corrected.
    if (Math.floor(Date.now() / 1000) % 5 === 0) {
      offset = await chainClockOffset(provider).catch(() => offset);
    }

    if (Date.now() > deadline) return;
    await new Promise((r) => setTimeout(r, pollMs));
  }
}
