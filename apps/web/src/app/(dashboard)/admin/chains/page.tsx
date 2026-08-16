'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Power, Trash2 } from 'lucide-react';
import type { ChainView } from '@mintbot/shared';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { TableSkeleton } from '@/components/ui/skeleton';

const emptyForm = {
  key: '',
  chainId: 1,
  name: '',
  explorer: '',
  nativeSymbol: 'ETH',
  publicRpcs: '',
  seadropAddress: '',
};

export default function AdminChainsPage() {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const chains = useQuery({
    queryKey: ['admin-chains'],
    queryFn: () => api.get<ChainView[]>('/admin/chains'),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin-chains'] });

  const createChain = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post('/admin/chains', body),
    onSuccess: () => {
      toast.success('Chain added');
      setCreateOpen(false);
      setForm(emptyForm);
      void invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateChain = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) =>
      api.patch(`/admin/chains/${id}`, body),
    onSuccess: () => {
      toast.success('Chain updated');
      void invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteChain = useMutation({
    mutationFn: (id: number) => api.delete(`/admin/chains/${id}`),
    onSuccess: () => {
      toast.success('Chain removed');
      void invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <>
      <PageHeader
        title="Chains"
        description="EVM networks available for mint tasks"
        actions={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" aria-hidden />
            Add chain
          </Button>
        }
      />

      <Card>
        {chains.isLoading ? (
          <TableSkeleton rows={3} />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Chain</TH>
                <TH>Chain ID</TH>
                <TH>SeaDrop</TH>
                <TH>RPCs</TH>
                <TH>Status</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {chains.data?.map((chain) => (
                <TR key={chain.id}>
                  <TD>
                    <p className="font-medium">{chain.name}</p>
                    <p className="text-xs text-text-muted">{chain.key}</p>
                  </TD>
                  <TD className="mono text-text-secondary">{chain.chainId}</TD>
                  <TD className="mono text-xs text-text-secondary">
                    {chain.seadropAddress?.slice(0, 10)}...
                  </TD>
                  <TD className="text-xs text-text-secondary">{chain.publicRpcs.length}</TD>
                  <TD>
                    <Badge tone={chain.isActive ? 'success' : 'neutral'}>
                      {chain.isActive ? 'active' : 'disabled'}
                    </Badge>
                  </TD>
                  <TD>
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label="Toggle chain"
                        onClick={() => updateChain.mutate({ id: chain.id, body: { isActive: !chain.isActive } })}
                      >
                        <Power className={`size-3.5 ${chain.isActive ? 'text-success' : 'text-text-muted'}`} aria-hidden />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label="Delete chain"
                        onClick={() => {
                          if (confirm(`Remove chain ${chain.name}?`)) deleteChain.mutate(chain.id);
                        }}
                      >
                        <Trash2 className="size-3.5 text-danger" aria-hidden />
                      </Button>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} title="Add chain" wide>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Key" hint="lowercase-with-dashes">
            <Input value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} placeholder="abstract" />
          </Field>
          <Field label="Chain ID">
            <Input
              type="number"
              value={form.chainId}
              onChange={(e) => setForm({ ...form, chainId: Number(e.target.value) })}
            />
          </Field>
          <Field label="Display name">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Explorer URL">
            <Input
              value={form.explorer}
              onChange={(e) => setForm({ ...form, explorer: e.target.value })}
              placeholder="https://explorer.example.com"
            />
          </Field>
          <Field label="Native symbol">
            <Input value={form.nativeSymbol} onChange={(e) => setForm({ ...form, nativeSymbol: e.target.value })} />
          </Field>
          <div className="md:col-span-2">
            <Field label="Public RPC URLs" hint="One per line">
              <textarea
                className="input-base min-h-20"
                value={form.publicRpcs}
                onChange={(e) => setForm({ ...form, publicRpcs: e.target.value })}
                placeholder={'https://rpc1.example.com\nhttps://rpc2.example.com'}
              />
            </Field>
          </div>
          <div className="md:col-span-2">
            <Field label="SeaDrop address (optional)" hint="Defaults to the canonical singleton">
              <Input
                value={form.seadropAddress}
                onChange={(e) => setForm({ ...form, seadropAddress: e.target.value })}
                className="mono"
              />
            </Field>
          </div>
          <div className="md:col-span-2">
            <Button
              onClick={() =>
                createChain.mutate({
                  key: form.key,
                  chainId: form.chainId,
                  name: form.name,
                  explorer: form.explorer,
                  nativeSymbol: form.nativeSymbol,
                  publicRpcs: form.publicRpcs.split('\n').map((u) => u.trim()).filter(Boolean),
                  seadropAddress: form.seadropAddress || undefined,
                })
              }
              loading={createChain.isPending}
            >
              Add chain
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
