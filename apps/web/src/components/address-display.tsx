'use client';

import { useState } from 'react';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { shortAddress, shortTx } from '@mintbot/shared';
import { cn } from '@/lib/utils';

export function AddressDisplay({
  address,
  explorer,
  full,
  className,
}: {
  address: string;
  explorer?: string;
  full?: boolean;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <span className="mono text-text-secondary">{full ? address : shortAddress(address, 6)}</span>
      <button
        onClick={onCopy}
        aria-label="Copy address"
        className="rounded p-0.5 text-text-muted transition-colors hover:text-text-primary"
      >
        {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
      </button>
      {explorer && (
        <a
          href={`${explorer}/address/${address}`}
          target="_blank"
          rel="noreferrer"
          aria-label="View on explorer"
          className="rounded p-0.5 text-text-muted transition-colors hover:text-accent"
        >
          <ExternalLink className="size-3.5" />
        </a>
      )}
    </span>
  );
}

export function TxLink({ txHash, explorer }: { txHash: string; explorer?: string }) {
  if (!explorer) return <span className="mono text-text-secondary">{shortTx(txHash)}</span>;
  return (
    <a
      href={`${explorer}/tx/${txHash}`}
      target="_blank"
      rel="noreferrer"
      className="mono text-accent hover:underline"
    >
      {shortTx(txHash)}
    </a>
  );
}
