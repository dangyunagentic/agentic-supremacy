'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { KeyRound, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import type { ChainView, WalletView } from '@mintbot/shared';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { AddressDisplay } from '@/components/address-display';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/input';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { TableSkeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/stat-card';
import { format } from 'date-fns';

export default function WalletsPage() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [mode, setMode] = useState<'generate' | 'import'>('generate');
  const [privateKey, setPrivateKey] = useState('');
  const [label, setLabel] = useState('');
  const [renameTarget, setRenameTarget] = useState<WalletView | null>(null);
  const [renameLabel, setRenameLabel] = useState('');

  const wallets = useQuery({
    queryKey: ['wallets'],
    queryFn: () => api.get<WalletView[]>('/wallets'),
  });
  const chains = useQuery({
    queryKey: ['chains'],
    queryFn: () => api.get<ChainView[]>('/chains'),
  });

  const createWallet = useMutation({
    mutationFn: (body: { mode: string; privateKey?: string; label?: string }) =>
      api.post<WalletView>('/wallets', body),
    onSuccess: (wallet) => {
      toast.success(`Wallet ${wallet.address.slice(0, 10)}... added`);
      setDialogOpen(false);
      setPrivateKey('');
      setLabel('');
      void queryClient.invalidateQueries({ queryKey: ['wallets'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteWallet = useMutation({
    mutationFn: (id: string) => api.delete(`/wallets/${id}`),
    onSuccess: () => {
      toast.success('Wallet removed');
      void queryClient.invalidateQueries({ queryKey: ['wallets'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const renameWallet = useMutation({
    mutationFn: ({ id, label }: { id: string; label: string }) =>
      api.patch<WalletView>(`/wallets/${id}/label`, { label }),
    onSuccess: () => {
      toast.success('Wallet renamed');
      setRenameTarget(null);
      setRenameLabel('');
      void queryClient.invalidateQueries({ queryKey: ['wallets'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const checkBalance = useMutation({
    mutationFn: (wallet: WalletView) =>
      api.get<{ balance: string }>(
        `/wallets/${wallet.id}/balance?chain=${chains.data?.[0]?.key ?? 'ethereum'}`,
      ),
    onSuccess: (data) => toast.info(`Balance: ${data.balance} ETH`),
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <>
      <PageHeader
        title="Wallets"
        description="Keys are AES-256-GCM encrypted at rest and never leave the server"
        actions={
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            <Plus className="size-4" aria-hidden />
            Add wallet
          </Button>
        }
      />

      <Card>
        {wallets.isLoading ? (
          <TableSkeleton rows={4} />
        ) : (wallets.data?.length ?? 0) === 0 ? (
          <EmptyState
            title="No wallets"
            description="Generate a fresh wallet or import an existing key. Keys are encrypted before they touch the database."
            action={
              <Button size="sm" variant="secondary" onClick={() => setDialogOpen(true)}>
                <KeyRound className="size-4" aria-hidden />
                Add your first wallet
              </Button>
            }
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Address</TH>
                <TH>Label</TH>
                <TH>Chain</TH>
                <TH>Added</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {wallets.data?.map((wallet) => (
                <TR key={wallet.id}>
                  <TD><AddressDisplay address={wallet.address} /></TD>
                  <TD className="text-text-secondary">{wallet.label ?? '-'}</TD>
                  <TD className="mono text-text-secondary">{wallet.chainId}</TD>
                  <TD className="text-text-secondary">
                    {format(new Date(wallet.createdAt), 'd MMM yyyy')}
                  </TD>
                  <TD>
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label="Rename wallet"
                        onClick={() => {
                          setRenameTarget(wallet);
                          setRenameLabel(wallet.label ?? '');
                        }}
                      >
                        <Pencil className="size-3.5" aria-hidden />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label="Check balance"
                        loading={checkBalance.isPending && checkBalance.variables?.id === wallet.id}
                        onClick={() => checkBalance.mutate(wallet)}
                      >
                        <RefreshCw className="size-3.5" aria-hidden />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label="Delete wallet"
                        onClick={() => {
                          if (confirm(`Remove wallet ${wallet.address.slice(0, 10)}...?`)) {
                            deleteWallet.mutate(wallet.id);
                          }
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

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} title="Add wallet">
        <div className="flex flex-col gap-4">
          <Field label="Mode">
            <Select value={mode} onChange={(e) => setMode(e.target.value as 'generate' | 'import')}>
              <option value="generate">Generate new wallet</option>
              <option value="import">Import private key</option>
            </Select>
          </Field>
          {mode === 'import' && (
            <Field label="Private key" hint="Encrypted immediately; never stored in plaintext">
              <Input
                type="password"
                value={privateKey}
                onChange={(e) => setPrivateKey(e.target.value)}
                placeholder="0x..."
                className="mono"
              />
            </Field>
          )}
          <Field label="Label (optional)">
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="main" />
          </Field>
          <Button
            onClick={() => createWallet.mutate({ mode, privateKey: privateKey || undefined, label: label || undefined })}
            loading={createWallet.isPending}
          >
            {mode === 'generate' ? 'Generate wallet' : 'Import wallet'}
          </Button>
        </div>
      </Dialog>

      <Dialog open={renameTarget !== null} onClose={() => setRenameTarget(null)} title="Rename wallet">
        <div className="flex flex-col gap-4">
          {renameTarget && (
            <p className="mono text-xs text-text-secondary break-all">{renameTarget.address}</p>
          )}
          <Field label="Label">
            <Input
              value={renameLabel}
              onChange={(e) => setRenameLabel(e.target.value)}
              placeholder="main"
              autoFocus
            />
          </Field>
          <Button
            onClick={() =>
              renameTarget &&
              renameWallet.mutate({ id: renameTarget.id, label: renameLabel.trim() })
            }
            loading={renameWallet.isPending}
          >
            Save label
          </Button>
        </div>
      </Dialog>
    </>
  );
}
