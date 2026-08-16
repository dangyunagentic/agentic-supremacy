'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { Banknote, Image as ImageIcon } from 'lucide-react';
import type { ChainView, Paginated, TransferJobView, WalletView } from '@mintbot/shared';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/input';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { TableSkeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

type Tab = 'fund' | 'sweep';

export default function TransfersPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('fund');

  const [fund, setFund] = useState({ chainKey: '', fromWalletId: '', toWalletIds: [] as string[], amountEth: '' });
  const [sweep, setSweep] = useState({ chainKey: '', fromWalletIds: [] as string[], recipientAddress: '', tokenContract: '', fromBlock: '' });

  const chains = useQuery({ queryKey: ['chains'], queryFn: () => api.get<ChainView[]>('/chains') });
  const wallets = useQuery({ queryKey: ['wallets'], queryFn: () => api.get<WalletView[]>('/wallets') });
  const history = useQuery({
    queryKey: ['transfers'],
    queryFn: () => api.get<Paginated<TransferJobView>>('/transfers?page=1&limit=25'),
    refetchInterval: 8_000,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['transfers'] });

  const fundMutation = useMutation({
    mutationFn: () => api.post<TransferJobView>('/transfers/fund', fund),
    onSuccess: (job) => {
      toast.success(`Fund job queued: ${job.targetCount} wallets`);
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const sweepMutation = useMutation({
    mutationFn: () =>
      api.post<TransferJobView>('/transfers/transfer-nft', {
        ...sweep,
        fromBlock: sweep.fromBlock ? Number(sweep.fromBlock) : undefined,
      }),
    onSuccess: (job) => {
      toast.success(`Transfer job queued: ${job.targetCount} wallets`);
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const toggle = (list: string[], id: string): string[] =>
    list.includes(id) ? list.filter((w) => w !== id) : [...list, id];

  const walletButton = (id: string, address: string, active: boolean, onClick: () => void) => (
    <button
      key={id}
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-[8px] border px-3 py-2 text-left transition-colors',
        active ? 'border-accent/50 bg-accent-subtle' : 'border-border bg-surface-2 hover:border-text-muted',
      )}
    >
      <span className="mono text-xs text-text-secondary">{address}</span>
    </button>
  );

  return (
    <>
      <PageHeader
        title="Transfers"
        description="Fund worker wallets from a main wallet, or transfer minted NFTs to one recipient"
      />

      {/* Tabs */}
      <div className="flex gap-1 pb-4">
        {(
          [
            { key: 'fund' as Tab, label: 'Fund wallets', icon: Banknote },
            { key: 'sweep' as Tab, label: 'Transfer NFTs', icon: ImageIcon },
          ]
        ).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              'flex items-center gap-2 rounded-[8px] border px-3 py-1.5 text-sm transition-colors',
              tab === key
                ? 'border-accent/50 bg-accent-subtle text-accent'
                : 'border-border bg-surface text-text-secondary hover:text-text-primary',
            )}
          >
            <Icon className="size-4" aria-hidden />
            {label}
          </button>
        ))}
      </div>

      {tab === 'fund' ? (
        <Card>
          <CardContent className="pt-5">
            <div className="grid gap-4 md:grid-cols-3">
              <Field label="Chain">
                <Select value={fund.chainKey} onChange={(e) => setFund({ ...fund, chainKey: e.target.value })}>
                  <option value="">Select chain</option>
                  {chains.data?.map((c) => (
                    <option key={c.key} value={c.key}>{c.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label="From (main wallet)">
                <Select
                  value={fund.fromWalletId}
                  onChange={(e) => setFund({ ...fund, fromWalletId: e.target.value })}
                >
                  <option value="">Select wallet</option>
                  {wallets.data
                    ?.filter((w) => !fund.toWalletIds.includes(w.id))
                    .map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.label ? `${w.label} - ` : ''}{w.address.slice(0, 12)}...
                      </option>
                    ))}
                </Select>
              </Field>
              <Field label="Amount per wallet (ETH)">
                <Input
                  value={fund.amountEth}
                  onChange={(e) => setFund({ ...fund, amountEth: e.target.value })}
                  placeholder="0.05"
                  className="mono"
                />
              </Field>
            </div>

            <div className="mt-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="label">Destination wallets ({fund.toWalletIds.length})</span>
                <button
                  className="text-xs text-accent hover:underline"
                  onClick={() =>
                    setFund({
                      ...fund,
                      toWalletIds:
                        fund.toWalletIds.length === (wallets.data?.length ?? 0)
                          ? []
                          : wallets.data?.filter((w) => w.id !== fund.fromWalletId).map((w) => w.id) ?? [],
                    })
                  }
                >
                  Toggle all
                </button>
              </div>
              <div className="grid max-h-48 gap-2 overflow-y-auto pr-1 md:grid-cols-3">
                {wallets.data
                  ?.filter((w) => w.id !== fund.fromWalletId)
                  .map((w) =>
                    walletButton(w.id, w.address, fund.toWalletIds.includes(w.id), () =>
                      setFund({ ...fund, toWalletIds: toggle(fund.toWalletIds, w.id) }),
                    ),
                  )}
              </div>
            </div>

            <Button
              className="mt-5"
              loading={fundMutation.isPending}
              disabled={
                !fund.chainKey || !fund.fromWalletId || fund.toWalletIds.length === 0 || !fund.amountEth
              }
              onClick={() => fundMutation.mutate()}
            >
              Send {fund.amountEth || 'ETH'} to {fund.toWalletIds.length} wallet(s)
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="pt-5">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Chain">
                <Select value={sweep.chainKey} onChange={(e) => setSweep({ ...sweep, chainKey: e.target.value })}>
                  <option value="">Select chain</option>
                  {chains.data?.map((c) => (
                    <option key={c.key} value={c.key}>{c.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Recipient address" hint="Where the NFTs go (usually your main wallet)">
                <Input
                  value={sweep.recipientAddress}
                  onChange={(e) => setSweep({ ...sweep, recipientAddress: e.target.value })}
                  placeholder="0x..."
                  className="mono"
                />
              </Field>
              <Field label="Token contract" hint="The NFT collection address to transfer">
                <Input
                  value={sweep.tokenContract}
                  onChange={(e) => setSweep({ ...sweep, tokenContract: e.target.value })}
                  placeholder="0x..."
                  className="mono"
                />
              </Field>
              <Field label="Scan from block (optional)" hint="Default: last 100k blocks">
                <Input
                  type="number"
                  value={sweep.fromBlock}
                  onChange={(e) => setSweep({ ...sweep, fromBlock: e.target.value })}
                  placeholder="auto"
                  className="mono"
                />
              </Field>
            </div>

            <div className="mt-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="label">Source wallets ({sweep.fromWalletIds.length})</span>
                <button
                  className="text-xs text-accent hover:underline"
                  onClick={() =>
                    setSweep({
                      ...sweep,
                      fromWalletIds:
                        sweep.fromWalletIds.length === (wallets.data?.length ?? 0)
                          ? []
                          : wallets.data?.map((w) => w.id) ?? [],
                    })
                  }
                >
                  Toggle all
                </button>
              </div>
              <div className="grid max-h-48 gap-2 overflow-y-auto pr-1 md:grid-cols-3">
                {wallets.data?.map((w) =>
                  walletButton(w.id, w.address, sweep.fromWalletIds.includes(w.id), () =>
                    setSweep({ ...sweep, fromWalletIds: toggle(sweep.fromWalletIds, w.id) }),
                  ),
                )}
              </div>
            </div>

            <Button
              className="mt-5"
              loading={sweepMutation.isPending}
              disabled={
                !sweep.chainKey ||
                sweep.fromWalletIds.length === 0 ||
                !sweep.recipientAddress ||
                !sweep.tokenContract
              }
              onClick={() => sweepMutation.mutate()}
            >
              Transfer NFTs from {sweep.fromWalletIds.length} wallet(s)
            </Button>
          </CardContent>
        </Card>
      )}

      {/* History */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Transfer history</CardTitle>
        </CardHeader>
        {history.isLoading ? (
          <TableSkeleton rows={4} />
        ) : (history.data?.data.length ?? 0) === 0 ? (
          <p className="px-5 pb-5 text-sm text-text-secondary">No transfers yet.</p>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Kind</TH>
                <TH>Chain</TH>
                <TH>Detail</TH>
                <TH>Status</TH>
                <TH>Results</TH>
                <TH>Created</TH>
              </TR>
            </THead>
            <TBody>
              {history.data?.data.map((job) => {
                const success = job.results.filter((r) => r.status === 'success').length;
                return (
                  <TR key={job.id}>
                    <TD>
                      <Badge tone={job.kind === 'fund' ? 'accent' : 'neutral'}>
                        {job.kind === 'fund' ? 'fund ETH' : 'transfer NFT'}
                      </Badge>
                    </TD>
                    <TD className="text-text-secondary">{job.chainKey}</TD>
                    <TD className="text-xs text-text-secondary">
                      {job.kind === 'fund'
                        ? `${job.amountEth} ETH x ${job.targetCount}`
                        : `${job.targetCount} wallet(s) to ${job.recipientAddress?.slice(0, 10)}...`}
                    </TD>
                    <TD>
                      <Badge
                        tone={
                          job.status === 'completed'
                            ? 'success'
                            : job.status === 'failed'
                              ? 'danger'
                              : 'warning'
                        }
                      >
                        {job.status}
                      </Badge>
                    </TD>
                    <TD className="mono text-text-secondary">
                      {job.results.length > 0 ? `${success}/${job.results.length}` : '-'}
                    </TD>
                    <TD className="text-text-secondary">
                      {format(new Date(job.createdAt), 'd MMM HH:mm')}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}
