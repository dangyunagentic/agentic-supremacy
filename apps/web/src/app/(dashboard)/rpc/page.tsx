'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Gauge, Plus, Zap } from 'lucide-react';
import type { ChainView, RpcEndpointView } from '@mintbot/shared';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/input';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { TableSkeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/stat-card';
import { cn } from '@/lib/utils';

const PROVIDERS = [
  { value: 'alchemy', label: 'Alchemy', hint: 'alchemy.com' },
  { value: 'quicknode', label: 'QuickNode', hint: 'quicknode.com' },
  { value: 'drpc', label: 'dRPC', hint: 'drpc.org' },
  { value: 'custom', label: 'Custom', hint: 'any endpoint' },
];

function latencyTone(ms: number | null) {
  if (ms === null) return 'neutral' as const;
  if (ms < 150) return 'success' as const;
  if (ms < 400) return 'warning' as const;
  return 'danger' as const;
}

export default function RpcPage() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [chainFilter, setChainFilter] = useState('');
  const [form, setForm] = useState({
    chainKey: '',
    label: '',
    url: '',
    provider: 'alchemy',
    tier: 'free',
  });

  const chains = useQuery({ queryKey: ['chains'], queryFn: () => api.get<ChainView[]>('/chains') });
  const endpoints = useQuery({
    queryKey: ['rpc-endpoints', chainFilter],
    queryFn: () =>
      api.get<RpcEndpointView[]>(`/rpc-endpoints${chainFilter ? `?chain=${chainFilter}` : ''}`),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['rpc-endpoints'] });

  const create = useMutation({
    mutationFn: (body: typeof form) => api.post<RpcEndpointView>('/rpc-endpoints', body),
    onSuccess: () => {
      toast.success('RPC endpoint saved');
      setDialogOpen(false);
      setForm({ chainKey: '', label: '', url: '', provider: 'alchemy', tier: 'free' });
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const ping = useMutation({
    mutationFn: (id: string) => api.post<RpcEndpointView>(`/rpc-endpoints/${id}/ping`),
    onSuccess: (endpoint) => {
      toast.success(`${endpoint.label}: ${endpoint.lastLatencyMs} ms`);
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/rpc-endpoints/${id}`),
    onSuccess: () => {
      toast.success('Endpoint removed');
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const list = endpoints.data ?? [];
  const byChain = list.reduce<Record<string, RpcEndpointView[]>>((acc, ep) => {
    (acc[ep.chainKey] ??= []).push(ep);
    return acc;
  }, {});

  return (
    <>
      <PageHeader
        title="RPC endpoints"
        description="Alchemy, QuickNode, dRPC or custom endpoints with live latency probes"
        actions={
          <div className="flex items-center gap-2">
            <Select
              value={chainFilter}
              onChange={(e) => setChainFilter(e.target.value)}
              className="h-8 w-40 text-[13px]"
            >
              <option value="">All chains</option>
              {chains.data?.map((c) => (
                <option key={c.key} value={c.key}>{c.name}</option>
              ))}
            </Select>
            <Button size="sm" onClick={() => setDialogOpen(true)}>
              <Plus className="size-4" aria-hidden />
              Add endpoint
            </Button>
          </div>
        }
      />

      {endpoints.isLoading ? (
        <Card>
          <TableSkeleton rows={4} />
        </Card>
      ) : list.length === 0 ? (
        <Card>
          <EmptyState
            title="No saved endpoints"
            description="Add an Alchemy, QuickNode or dRPC URL (free or paid tier) and probe its latency before a mint."
            action={
              <Button size="sm" variant="secondary" onClick={() => setDialogOpen(true)}>
                <Gauge className="size-4" aria-hidden />
                Add your first endpoint
              </Button>
            }
          />
        </Card>
      ) : (
        Object.entries(byChain).map(([chainKey, eps]) => (
          <Card key={chainKey} className="mb-4">
            <Table>
              <THead>
                <TR>
                  <TH colSpan={5} className="text-text-primary">
                    {chains.data?.find((c) => c.key === chainKey)?.name ?? chainKey}
                  </TH>
                </TR>
                <TR>
                  <TH>Label</TH>
                  <TH>Provider</TH>
                  <TH>Tier</TH>
                  <TH>Latency</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {eps.map((ep) => (
                  <TR key={ep.id}>
                    <TD>
                      <p className="font-medium">{ep.label}</p>
                      <p className="mono max-w-72 truncate text-xs text-text-muted">{ep.url}</p>
                    </TD>
                    <TD>
                      <Badge tone="accent">{ep.provider}</Badge>
                    </TD>
                    <TD>
                      <Badge tone={ep.tier === 'paid' ? 'warning' : 'neutral'}>{ep.tier}</Badge>
                    </TD>
                    <TD>
                      <Badge tone={latencyTone(ep.lastLatencyMs)}>
                        {ep.lastLatencyMs !== null ? `${ep.lastLatencyMs} ms` : 'not probed'}
                      </Badge>
                    </TD>
                    <TD>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="sm"
                          variant="secondary"
                          loading={ping.isPending && ping.variables === ep.id}
                          onClick={() => ping.mutate(ep.id)}
                        >
                          <Zap className="size-3.5" aria-hidden />
                          Ping
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label="Delete endpoint"
                          onClick={() => {
                            if (confirm(`Remove ${ep.label}?`)) remove.mutate(ep.id);
                          }}
                        >
                          <span className="text-danger">Delete</span>
                        </Button>
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Card>
        ))
      )}

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} title="Add RPC endpoint">
        <div className="flex flex-col gap-4">
          <Field label="Provider">
            <Select
              value={form.provider}
              onChange={(e) => setForm({ ...form, provider: e.target.value })}
            >
              {PROVIDERS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label} ({p.hint})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Chain">
            <Select value={form.chainKey} onChange={(e) => setForm({ ...form, chainKey: e.target.value })}>
              <option value="">Select chain</option>
              {chains.data?.map((c) => (
                <option key={c.key} value={c.key}>{c.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Endpoint URL" hint="Include your API key, e.g. https://eth-mainnet.g.alchemy.com/v2/<key>">
            <Input
              value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
              placeholder="https://..."
              className="mono"
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Tier">
              <Select value={form.tier} onChange={(e) => setForm({ ...form, tier: e.target.value })}>
                <option value="free">Free</option>
                <option value="paid">Paid</option>
              </Select>
            </Field>
            <Field label="Label (optional)">
              <Input
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                placeholder="alchemy-mainnet"
              />
            </Field>
          </div>
          <Button
            onClick={() => create.mutate(form)}
            loading={create.isPending}
            disabled={!form.chainKey || !form.url.startsWith('http')}
          >
            Save endpoint
          </Button>
        </div>
      </Dialog>
    </>
  );
}
