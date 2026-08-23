'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Blocks, Plus, Trash2 } from 'lucide-react';
import type { ChainView } from '@mintbot/shared';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { TableSkeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/stat-card';

const emptyForm = {
  key: '',
  chainId: 1,
  name: '',
  explorer: '',
  nativeSymbol: 'ETH',
  publicRpcs: '',
  seadropAddress: '',
};

export default function ChainsPage() {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [deleteTarget, setDeleteTarget] = useState<ChainView | null>(null);

  const chains = useQuery({
    queryKey: ['chains'],
    queryFn: () => api.get<ChainView[]>('/chains'),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['chains'] });

  const createChain = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post('/chains', body),
    onSuccess: () => {
      toast.success('Chain added');
      setCreateOpen(false);
      setForm(emptyForm);
      void invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteChain = useMutation({
    mutationFn: (id: number) => api.delete(`/chains/${id}`),
    onSuccess: () => {
      toast.success('Chain deleted');
      setDeleteTarget(null);
      void invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const list = chains.data ?? [];

  const canDelete = (chain: ChainView) =>
    user?.role === 'admin' || (user?.id != null && chain.ownerId === user.id);

  return (
    <>
      <PageHeader
        title="Chains"
        description="EVM networks available for mint tasks — add a newly-launched chain without waiting for an admin"
        actions={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" aria-hidden />
            Add chain
          </Button>
        }
      />

      {chains.isLoading ? (
        <Card>
          <TableSkeleton rows={3} />
        </Card>
      ) : list.length === 0 ? (
        <Card>
          <EmptyState
            title="No chains"
            description="Add a chain (key, chain ID, RPC URLs) to start minting on it."
            action={
              <Button size="sm" variant="secondary" onClick={() => setCreateOpen(true)}>
                <Blocks className="size-4" aria-hidden />
                Add your first chain
              </Button>
            }
          />
        </Card>
      ) : (
        <Card>
          <Table>
            <THead>
              <TR>
                <TH>Chain</TH>
                <TH>Chain ID</TH>
                <TH>SeaDrop</TH>
                <TH>RPCs</TH>
                <TH>Status</TH>
                <TH className="text-right">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {list.map((chain) => (
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
                  <TD className="text-right">
                    {canDelete(chain) && (
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => setDeleteTarget(chain)}
                      >
                        <Trash2 className="size-4" aria-hidden />
                        Delete
                      </Button>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}

      <Dialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Delete chain"
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-text-secondary">
            Are you sure you want to delete{' '}
            <span className="font-medium text-text-primary">{deleteTarget?.name}</span> (
            {deleteTarget?.key})? This cannot be undone.
          </p>
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setDeleteTarget(null)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              variant="danger"
              loading={deleteChain.isPending}
              onClick={() => deleteTarget && deleteChain.mutate(deleteTarget.id)}
            >
              <Trash2 className="size-4" aria-hidden />
              Delete chain
            </Button>
          </div>
        </div>
      </Dialog>

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
