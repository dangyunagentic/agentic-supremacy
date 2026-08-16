'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { BadgeCheck, CircleX } from 'lucide-react';
import type { ChainView, EligibilityReport, WalletView } from '@mintbot/shared';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/input';
import { AddressDisplay } from '@/components/address-display';
import { cn } from '@/lib/utils';

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
        description="Public stages fit every wallet; GTD and FCFS are checked per wallet"
      />

      <Card>
        <CardContent className="pt-5">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="md:col-span-2">
              <Field
                label="Collection"
                hint="Contract address for public drops, OpenSea slug/URL for GTD and FCFS"
              >
                <Input
                  value={collection}
                  onChange={(e) => setCollection(e.target.value)}
                  placeholder="0x... or collection-slug"
                  className="mono"
                />
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
                <button className="text-xs text-text-muted hover:underline" onClick={() => setSelected([])}>
                  Clear
                </button>
              </div>
            </div>
            <div className="grid max-h-56 gap-2 overflow-y-auto pr-1 md:grid-cols-3">
              {wallets.data?.map((wallet) => {
                const isSelected = selected.includes(wallet.id);
                return (
                  <button
                    key={wallet.id}
                    type="button"
                    onClick={() => toggleWallet(wallet.id)}
                    className={cn(
                      'rounded-[8px] border px-3 py-2 text-left transition-colors',
                      isSelected
                        ? 'border-accent/50 bg-accent-subtle'
                        : 'border-border bg-surface-2 hover:border-text-muted',
                    )}
                  >
                    <span className="mono text-xs text-text-secondary">{wallet.address}</span>
                  </button>
                );
              })}
              {(wallets.data?.length ?? 0) === 0 && (
                <p className="text-sm text-text-secondary md:col-span-3">
                  No wallets yet.{' '}
                  <Link href="/wallets" className="text-accent hover:underline">
                    Add one first
                  </Link>
                  .
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {report && (
        <Card className="mt-4">
          <CardContent className="pt-5">
            <div className="flex flex-wrap items-center gap-2 pb-4">
              <Badge tone="accent">{report.mode}</Badge>
              {report.stageStart && (
                <Badge>
                  opens {new Date(report.stageStart).toLocaleString()}
                </Badge>
              )}
              {report.mintPrice && <Badge>price {report.mintPrice} ETH</Badge>}
              {report.maxPerWallet && <Badge>max {report.maxPerWallet}/wallet</Badge>}
            </div>
            <div className="flex flex-col divide-y divide-border">
              {report.wallets.map((w) => (
                <div key={w.address} className="flex flex-wrap items-center gap-3 py-2.5">
                  {w.eligible ? (
                    <BadgeCheck className="size-4 shrink-0 text-success" aria-hidden />
                  ) : (
                    <CircleX className="size-4 shrink-0 text-danger" aria-hidden />
                  )}
                  <AddressDisplay address={w.address} />
                  <span className="w-full text-xs text-text-muted md:w-auto md:flex-1">{w.reason}</span>
                  <Badge tone={w.eligible ? 'success' : 'danger'}>
                    {w.eligible ? 'eligible' : 'not eligible'}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}
