'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { BadgeCheck, CircleX, Loader2, Sparkles, ExternalLink } from 'lucide-react';
import type { ChainView, EligibilityReport, WalletView } from '@mintbot/shared';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/input';
import { AddressDisplay } from '@/components/address-display';
import { cn } from '@/lib/utils';

interface ResolvedCollection {
  name: string | null;
  slug: string | null;
  contractAddress: string | null;
  chainKey: string | null;
  symbol: string | null;
  imageUrl: string | null;
  bannerUrl: string | null;
  description: string | null;
  totalSupply: number | null;
  source: 'opensea' | 'onchain' | 'unknown';
}

export default function EligibilityPage() {
  const [collection, setCollection] = useState('');
  const [chainKey, setChainKey] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [report, setReport] = useState<EligibilityReport | null>(null);

  const chains = useQuery({
    queryKey: ['chains'],
    queryFn: () => api.get<ChainView[]>('/chains'),
  });
  const wallets = useQuery({
    queryKey: ['wallets'],
    queryFn: () => api.get<WalletView[]>('/wallets'),
  });

  const resolvedMeta = useQuery({
    queryKey: ['resolve-collection', collection, chainKey],
    queryFn: () =>
      api.get<ResolvedCollection>(
        `/eligibility/resolve?input=${encodeURIComponent(collection.trim())}&chainKey=${chainKey || ''}`,
      ),
    enabled: collection.trim().length > 2,
    staleTime: 60_000,
  });

  // Auto-fill chain if detected from link
  useEffect(() => {
    if (resolvedMeta.data?.chainKey && (!chainKey || resolvedMeta.data.source === 'opensea')) {
      const match = chains.data?.find(
        (c) => c.key.toLowerCase() === resolvedMeta.data?.chainKey?.toLowerCase(),
      );
      if (match) setChainKey(match.key);
    }
  }, [resolvedMeta.data?.chainKey, chains.data]);

  const check = useMutation({
    mutationFn: () =>
      api.post<EligibilityReport>('/eligibility/check', {
        collection,
        chainKey,
        walletIds: selected,
        quantity,
      }),
    onSuccess: (data) => {
      setReport(data);
      const eligible = data.wallets.filter((w) => w.eligible).length;
      toast.success(`${eligible}/${data.wallets.length} wallets eligible (${data.mode})`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const toggleWallet = (id: string) =>
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((w) => w !== id) : [...prev, id],
    );

  const valid = collection.trim().length > 1 && chainKey !== '' && selected.length > 0;

  return (
    <>
      <PageHeader
        title="Eligibility"
        description="Public stages fit every wallet; GTD and FCFS are checked per wallet across all chains"
      />

      <Card>
        <CardContent className="pt-5">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="md:col-span-2">
              <Field
                label="Collection"
                hint="Contract Address (0x...), OpenSea URL, or collection slug (Auto-detected)"
              >
                <div className="relative">
                  <Input
                    value={collection}
                    onChange={(e) => setCollection(e.target.value)}
                    placeholder="0x... or https://opensea.io/collection/... or slug"
                    className="mono pr-8"
                  />
                  {resolvedMeta.isFetching && (
                    <div className="absolute right-2.5 top-2.5">
                      <Loader2 className="size-4 animate-spin text-accent" />
                    </div>
                  )}
                </div>
              </Field>
            </div>
            <Field label="Chain">
              <Select value={chainKey} onChange={(e) => setChainKey(e.target.value)}>
                <option value="">Select chain</option>
                {chains.data?.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          {/* NFT / Collection Preview Card */}
          {resolvedMeta.data && (resolvedMeta.data.name || resolvedMeta.data.imageUrl) && (
            <div className="mt-3 flex items-center gap-3 rounded-[8px] border border-accent/30 bg-accent-subtle/50 p-3">
              {resolvedMeta.data.imageUrl ? (
                <img
                  src={resolvedMeta.data.imageUrl}
                  alt={resolvedMeta.data.name || 'NFT'}
                  className="size-12 rounded-[6px] object-cover border border-border"
                />
              ) : (
                <div className="flex size-12 items-center justify-center rounded-[6px] bg-surface-2 border border-border">
                  <Sparkles className="size-5 text-accent" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="font-medium text-text-primary truncate text-sm">
                    {resolvedMeta.data.name || resolvedMeta.data.slug}
                  </p>
                  {resolvedMeta.data.symbol && (
                    <Badge tone="neutral" className="text-[10px] uppercase">
                      {resolvedMeta.data.symbol}
                    </Badge>
                  )}
                  <Badge tone={resolvedMeta.data.source === 'opensea' ? 'accent' : 'success'} className="text-[10px]">
                    {resolvedMeta.data.source}
                  </Badge>
                </div>
                <div className="flex items-center gap-3 mt-1 text-xs text-text-secondary">
                  {resolvedMeta.data.contractAddress && (
                    <span className="mono truncate max-w-[200px]">
                      {resolvedMeta.data.contractAddress}
                    </span>
                  )}
                  {resolvedMeta.data.totalSupply && (
                    <span>Supply: {resolvedMeta.data.totalSupply.toLocaleString()}</span>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="mt-4 flex items-center gap-4">
            <Field label="Quantity per wallet">
              <Input
                type="number"
                min={1}
                max={50}
                value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value))}
                className="w-28"
              />
            </Field>
            <Button
              className="mt-6"
              onClick={() => check.mutate()}
              loading={check.isPending}
              disabled={!valid}
            >
              <BadgeCheck className="size-4" aria-hidden />
              Check eligibility
            </Button>
          </div>

          <div className="mt-6">
            <div className="mb-2 flex items-center justify-between">
              <span className="label">Wallets to check</span>
              <div className="flex gap-2">
                <button
                  className="text-xs text-accent hover:underline"
                  onClick={() => setSelected(wallets.data?.map((w) => w.id) ?? [])}
                >
                  Select all
                </button>
                <span className="text-text-muted">/</span>
                <button
                  className="text-xs text-text-secondary hover:underline"
                  onClick={() => setSelected([])}
                >
                  Clear
                </button>
              </div>
            </div>

            <div className="grid max-h-56 gap-2 overflow-y-auto pr-1 md:grid-cols-3">
              {wallets.data?.map((w) => {
                const active = selected.includes(w.id);
                return (
                  <button
                    key={w.id}
                    type="button"
                    onClick={() => toggleWallet(w.id)}
                    className={cn(
                      'flex items-center justify-between rounded-[8px] border px-3 py-2 text-left transition-colors',
                      active
                        ? 'border-accent/50 bg-accent-subtle'
                        : 'border-border bg-surface-2 hover:border-text-muted',
                    )}
                  >
                    <span className="mono text-xs text-text-secondary">
                      {w.label ? `${w.label} - ` : ''}
                      {w.address.slice(0, 10)}...{w.address.slice(-4)}
                    </span>
                    <div
                      className={cn(
                        'size-3.5 rounded-[4px] border',
                        active ? 'border-accent bg-accent' : 'border-border',
                      )}
                    />
                  </button>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Report */}
      {report && (
        <Card className="mt-6">
          <CardContent className="pt-5">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
              <div>
                <p className="text-xs text-text-secondary">Mode detected</p>
                <div className="mt-1 flex items-center gap-2">
                  <Badge tone={report.mode === 'public' ? 'neutral' : 'accent'}>
                    {report.mode.toUpperCase()}
                  </Badge>
                  {report.mintPrice && (
                    <span className="mono text-sm text-text-secondary">
                      {report.mintPrice} ETH
                    </span>
                  )}
                  {report.maxPerWallet && (
                    <span className="text-xs text-text-secondary">
                      (max {report.maxPerWallet}/wallet)
                    </span>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <Link
                  href={`/tasks?create=true&collection=${encodeURIComponent(report.collection)}&chain=${report.chainKey}&mode=${report.mode}`}
                >
                  <Button size="sm">Create task from this</Button>
                </Link>
              </div>
            </div>

            <div className="mt-4 flex flex-col gap-2">
              {report.wallets.map((w) => (
                <div
                  key={w.address}
                  className="flex items-center justify-between rounded-[8px] border border-border bg-surface-2 px-3 py-2 text-sm"
                >
                  <AddressDisplay address={w.address} />
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-text-secondary">{w.reason}</span>
                    {w.eligible ? (
                      <Badge tone="success" className="gap-1">
                        <BadgeCheck className="size-3" aria-hidden />
                        Eligible
                      </Badge>
                    ) : (
                      <Badge tone="danger" className="gap-1">
                        <CircleX className="size-3" aria-hidden />
                        Not eligible
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}
