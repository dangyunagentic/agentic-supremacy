'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Sparkles, ExternalLink, Search } from 'lucide-react';
import type { ChainView } from '@mintbot/shared';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface TraitEntry {
  traitType: string;
  value: string;
  rarityScore: number;
  occurrence: number;
}

interface TokenRarity {
  tokenId: string;
  rarityScore: number;
  rank: number;
  traits: TraitEntry[];
  imageUrl: string | null;
  name: string | null;
}

interface RarityReport {
  collection: string;
  slug: string | null;
  contractAddress: string | null;
  chainKey: string;
  totalScanned: number;
  tokens: TokenRarity[];
  traitFrequency: Record<string, Record<string, number>>;
  scannedAt: string;
  source: 'opensea' | 'onchain' | 'unknown';
}

export default function RarityPage() {
  const [input, setInput] = useState('');
  const [chainKey, setChainKey] = useState('');
  const [maxScan, setMaxScan] = useState(500);
  const [triggered, setTriggered] = useState(false);

  const chains = useQuery({
    queryKey: ['chains'],
    queryFn: () => api.get<ChainView[]>('/chains'),
  });

  const scan = useQuery({
    queryKey: ['rarity', input, chainKey, maxScan, triggered],
    queryFn: () =>
      api.get<RarityReport>(
        `/eligibility/rarity?input=${encodeURIComponent(input.trim())}&chainKey=${chainKey || ''}&maxScan=${maxScan}`,
      ),
    enabled: triggered && input.trim().length > 2,
    staleTime: 60_000,
  });

  const runScan = () => {
    if (input.trim().length < 3) return;
    setTriggered(true);
  };

  const topTokens = scan.data?.tokens ?? [];
  const [searchTrait, setSearchTrait] = useState('');
  const [searchVal, setSearchVal] = useState('');

  const filtered = topTokens.filter((t) => {
    if (!searchTrait && !searchVal) return true;
    return t.traits.some(
      (tr) =>
        (!searchTrait || tr.traitType.toLowerCase().includes(searchTrait.toLowerCase())) &&
        (!searchVal || tr.value.toLowerCase().includes(searchVal.toLowerCase())),
    );
  });

  const explorer = chains.data?.find((c) => c.key === scan.data?.chainKey)?.explorer;

  return (
    <>
      <PageHeader
        title="Trait Sniper / Rarity Scanner"
        description="Scan NFT metadata, compute rarity scores per token, and find the rarest IDs to target"
      />

      <Card>
        <CardContent className="pt-5">
          <div className="grid gap-4 md:grid-cols-12">
            <div className="md:col-span-5">
              <Field
                label="Collection"
                hint="Contract Address (0x...), OpenSea URL, or slug"
              >
                <Input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="0x... or https://opensea.io/collection/slug"
                  className="mono"
                />
              </Field>
            </div>
            <div className="md:col-span-3">
              <Field label="Chain">
                <Select value={chainKey} onChange={(e) => setChainKey(e.target.value)}>
                  <option value="">Auto detect</option>
                  {chains.data?.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="md:col-span-2">
              <Field label="Max Scan">
                <Input
                  type="number"
                  min={10}
                  max={2000}
                  value={maxScan}
                  onChange={(e) => setMaxScan(Number(e.target.value))}
                />
              </Field>
            </div>
            <div className="md:col-span-2 flex items-end">
              <Button className="w-full" onClick={runScan} loading={scan.isFetching} disabled={input.trim().length < 3}>
                <Search className="size-4" aria-hidden />
                Scan
              </Button>
            </div>
          </div>

          {scan.data && (
            <div className="mt-4 flex flex-wrap items-center gap-2 rounded-[8px] border border-border bg-surface-2 px-3 py-2 text-xs text-text-secondary">
              <Badge tone="accent">{scan.data.source}</Badge>
              <span>{scan.data.totalScanned} tokens scanned</span>
              <span className="text-text-muted">·</span>
              <span>Contract: <span className="mono">{scan.data.contractAddress?.slice(0, 10)}...</span></span>
              <span className="text-text-muted">·</span>
              <span>Scanned {new Date(scan.data.scannedAt).toLocaleString()}</span>
            </div>
          )}

          {scan.error && (
            <p className="mt-4 rounded-[8px] border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
              {(scan.error as Error).message}
            </p>
          )}
        </CardContent>
      </Card>

      {scan.data && topTokens.length > 0 && (
        <Card className="mt-4">
          <CardContent className="pt-4">
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="label">Trait filter</span>
                <input
                  value={searchTrait}
                  onChange={(e) => setSearchTrait(e.target.value)}
                  placeholder="trait_type (e.g. Background)"
                  className="input-base h-8 w-44 text-xs"
                />
                <input
                  value={searchVal}
                  onChange={(e) => setSearchVal(e.target.value)}
                  placeholder="value (e.g. Gold)"
                  className="input-base h-8 w-40 text-xs"
                />
              </div>
              <span className="text-xs text-text-muted">
                {filtered.length} of {topTokens.length} tokens match
              </span>
            </div>

            {/* Top 10 Rare */}
            <h3 className="mb-2 text-sm font-semibold text-text-primary">🏆 Top 10 Rarest</h3>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              {topTokens.slice(0, 10).map((t) => (
                <div key={t.tokenId} className="rounded-[8px] border border-border bg-surface-2 p-2">
                  <div className="flex items-start justify-between gap-2">
                    {t.imageUrl ? (
                      <img src={t.imageUrl} alt={t.tokenId} className="size-10 rounded-[4px] object-cover" />
                    ) : (
                      <div className="flex size-10 items-center justify-center rounded-[4px] bg-surface border border-border">
                        <Sparkles className="size-4 text-accent" />
                      </div>
                    )}
                    <Badge tone="accent" className="text-[10px]">#{t.rank}</Badge>
                  </div>
                  <p className="mono mt-1 text-xs text-text-primary">#{t.tokenId}</p>
                  <p className="text-[10px] text-text-muted">Score: {t.rarityScore.toFixed(4)}</p>
                  {t.traits.slice(0, 3).map((tr) => (
                    <p key={tr.traitType} className="truncate text-[9px] text-text-secondary">
                      {tr.traitType}: <span className="text-accent">{tr.value}</span> ({tr.occurrence})
                    </p>
                  ))}
                  {explorer && (
                    <a
                      href={`${explorer}/token/${scan.data?.contractAddress}/instance/${t.tokenId}`}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 inline-flex items-center gap-1 text-[10px] text-accent hover:underline"
                    >
                      View <ExternalLink className="size-2.5" />
                    </a>
                  )}
                </div>
              ))}
            </div>

            {/* Full table */}
            <h3 className="mb-2 mt-5 text-sm font-semibold text-text-primary">All Tokens by Rarity</h3>
            <div className="overflow-x-auto rounded-[8px] border border-border bg-surface">
              <table className="w-full text-xs">
                <thead className="bg-surface-2/50 text-[11px] uppercase tracking-wider text-text-muted">
                  <tr>
                    <th className="px-3 py-2 text-left">Rank</th>
                    <th className="px-3 py-2 text-left">Token ID</th>
                    <th className="px-3 py-2 text-left">Score</th>
                    <th className="px-3 py-2 text-left">Image</th>
                    <th className="px-3 py-2 text-left">Traits</th>
                    <th className="px-3 py-2 text-left">Link</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((t) => (
                    <tr key={t.tokenId} className={cn('border-t border-border', t.rank <= 10 && 'bg-accent-subtle/40')}>
                      <td className="px-3 py-2">
                        {t.rank <= 3 ? <Badge tone="accent">#{t.rank}</Badge> : <span className="text-text-muted">#{t.rank}</span>}
                      </td>
                      <td className="mono px-3 py-2 text-text-primary">#{t.tokenId}</td>
                      <td className="px-3 py-2 font-mono text-accent">{t.rarityScore.toFixed(4)}</td>
                      <td className="px-3 py-2">
                        {t.imageUrl && <img src={t.imageUrl} alt="" className="size-7 rounded-[4px] object-cover" />}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex max-w-[420px] flex-wrap gap-1">
                          {t.traits.map((tr) => (
                            <span key={`${tr.traitType}:${tr.value}`} className="rounded bg-surface-2 border border-border px-1.5 py-0.5 text-[9px] text-text-secondary">
                              {tr.traitType}: <span className="text-accent">{tr.value}</span> ×{tr.occurrence}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        {explorer && (
                          <a
                            href={`${explorer}/token/${scan.data?.contractAddress}/instance/${t.tokenId}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-accent hover:underline"
                          >
                            View <ExternalLink className="size-3" />
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {scan.isFetching && (
        <div className="mt-6 flex items-center justify-center gap-2 text-text-muted">
          <Loader2 className="size-4 animate-spin text-accent" />
          Scanning metadata & computing rarity...
        </div>
      )}
    </>
  );
}
