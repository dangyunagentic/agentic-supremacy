'use client';

import { useEffect, useState } from 'react';
import { formatCountdown } from '@mintbot/shared';
import { cn } from '@/lib/utils';

export function CountdownTimer({
  target,
  className,
}: {
  target: string | Date;
  className?: string;
}) {
  const targetMs = new Date(target).getTime();
  const [remaining, setRemaining] = useState(targetMs - Date.now());

  useEffect(() => {
    const id = setInterval(() => setRemaining(targetMs - Date.now()), 1000);
    return () => clearInterval(id);
  }, [targetMs]);

  const soon = remaining > 0 && remaining < 10_000;

  return (
    <span
      className={cn(
        'mono tabular-nums',
        remaining <= 0 ? 'text-text-muted' : soon ? 'text-warning animate-pulse' : 'text-text-primary',
        className,
      )}
    >
      {remaining <= 0 ? 'fired' : formatCountdown(remaining)}
    </span>
  );
}
