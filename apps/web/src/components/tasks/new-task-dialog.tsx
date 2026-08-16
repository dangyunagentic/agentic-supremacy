'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ChevronDown, Check, Rocket, Search } from 'lucide-react';
import {
  MintMode,
  TimingMode,
  WalletMode,
  MAX_WALLETS_PER_TASK,
  type ChainView,
  type CreateTaskInput,
  type RpcEndpointView,
  type TaskView,
  type WalletView,
} from '@mintbot/shared';
import { api } from '@/lib/api';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface NewTaskForm {
  name: string;
  collection: string;
  chainKey: string;
  walletIds: string[];
  quantity: number;
  mintMode: MintMode;
  walletMode: WalletMode;
  maxFeeGwei: number;
  maxPriorityGwei: number;
  gasLimit: number;
  timingMode: TimingMode;
  customFireTime: string;
}

export function NewTaskDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [form, setForm] = useState<NewTaskForm>({
    name: '',
    collection: '',
    chainKey: '',
    walletIds: [],
    quantity: 1,
    mintMode: MintMode.Auto,
    walletMode: WalletMode.SelfFunded,
    maxFeeGwei: 2,
    maxPriorityGwei: 0.05,
    gasLimit: 250000,
    timingMode: TimingMode.WaitForStage,
    customFireTime: '',
  });
  const [selectedRpcIds, setSelectedRpcIds] = useState<string[]>([]);
  const [customRpcs, setCustomRpcs] = useState('');
  const [walletMenuOpen, setWalletMenuOpen] = useState(false);
  const [walletSearch, setWalletSearch] = useState('');

  const chains = useQuery({
    queryKey: ['chains'],
    queryFn: () => api.get<ChainView[]>('/chains'),
  });
  const wallets = useQuery({
    queryKey: ['wallets'],
    queryFn: () => api.get<WalletView[]>('/wallets'),
  });
  const rpcEndpoints = useQuery({
    queryKey: ['rpc-endpoints', form.chainKey],
    queryFn: () =>
      api.get<RpcEndpointView[]>(`/rpc-endpoints${form.chainKey ? `?chain=${form.chainKey}` : ''}`),
  });

  const create = useMutation({
    mutationFn: (input: CreateTaskInput) => api.post<TaskView>('/tasks', input),
    onSuccess: (task) => {
      toast.success(`Task "${task.name}" scheduled`);
      onClose();
      router.push(`/tasks/${task.id}`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const walletCap = MAX_WALLETS_PER_TASK[form.walletMode] ?? 1;
  const gasValid = form.maxPriorityGwei < form.maxFeeGwei && form.maxFeeGwei > 0;
  const timingValid =
    form.timingMode !== TimingMode.CustomTime ||
    new Date(form.customFireTime).getTime() > Date.now() + 10_000;

  const set = <K extends keyof NewTaskForm>(key: K, value: NewTaskForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const toggleWallet = (id: string) => {
    setForm((f) => {
      const selected = f.walletIds.includes(id);
      if (selected) return { ...f, walletIds: f.walletIds.filter((w) => w !== id) };
      if (f.walletIds.length >= walletCap) return f;
      return { ...f, walletIds: [...f.walletIds, id] };
    });
  };

  const visibleWallets = (wallets.data ?? []).filter((w) => {
    const q = walletSearch.trim().toLowerCase();
    if (!q) return true;
    return (w.label ?? '').toLowerCase().includes(q) || w.address.toLowerCase().includes(q);
  });
  const allVisibleSelected =
    visibleWallets.length > 0 && visibleWallets.every((w) => form.walletIds.includes(w.id));

  const toggleAllWallets = () => {
    setForm((f) => {
      const visibleIds = visibleWallets.map((w) => w.id);
      if (allVisibleSelected) {
        const visibleSet = new Set(visibleIds);
        return { ...f, walletIds: f.walletIds.filter((id) => !visibleSet.has(id)) };
      }
      const merged = new Set([...f.walletIds, ...visibleIds]);
      const capped = [...merged].slice(0, Number.isFinite(walletCap) ? walletCap : merged.size);
      return { ...f, walletIds: capped };
    });
  };

  const submit = () => {
    create.mutate({
      name: form.name,
      collection: form.collection,
      chainKey: form.chainKey,
      walletIds: form.walletIds,
      quantity: form.quantity,
      mintMode: form.mintMode,
      walletMode: form.walletMode,
      maxFeeGwei: form.maxFeeGwei,
      maxPriorityGwei: form.maxPriorityGwei,
      gasLimit: form.gasLimit,
      rpcUrls: [
        ...(rpcEndpoints.data ?? [])
          .filter((ep) => selectedRpcIds.includes(ep.id))
          .map((ep) => ep.url),
        ...customRpcs.split('\n').map((u) => u.trim()).filter((u) => u.startsWith('http')),
      ],
      timingMode: form.timingMode,
      customFireTime: form.timingMode === TimingMode.CustomTime ? new Date(form.customFireTime).toISOString() : null,
    });
  };

  const collectionValid = form.name.trim().length > 0 && form.collection.trim().length > 1 && form.chainKey !== '';
  const walletsValid = form.walletIds.length > 0 && form.walletIds.length <= walletCap && form.quantity >= 1;
  const canSubmit = collectionValid && walletsValid && gasValid && form.gasLimit >= 21000 && timingValid;

  return (
    <Dialog open={open} onClose={onClose} title="New task" size="lg">
      <div className="grid gap-4 md:grid-cols-2">
        {/* Collection */}
        <div className="flex flex-col gap-4 md:col-span-2">
          <Field label="Task name">
            <Input
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="Bored Apes public mint"
            />
          </Field>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Chain">
              <Select value={form.chainKey} onChange={(e) => set('chainKey', e.target.value)}>
                <option value="">Select chain</option>
                {chains.data?.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.name} ({c.chainId})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Mint mode" hint="Auto resolves the stage from the chain">
              <Select
                value={form.mintMode}
                onChange={(e) => set('mintMode', e.target.value as MintMode)}
              >
                <option value={MintMode.Auto}>Auto detect</option>
                <option value={MintMode.Public}>Public</option>
                <option value={MintMode.Allowlist}>Allowlist</option>
                <option value={MintMode.Fcfs}>FCFS</option>
              </Select>
            </Field>
          </div>
          <Field
            label="Collection"
            hint="Contract address (public mints, no OpenSea account needed) or OpenSea slug / URL (allowlist and FCFS)"
          >
            <Input
              value={form.collection}
              onChange={(e) => set('collection', e.target.value)}
              placeholder="0x... or bored-ape-yacht-club"
              className="mono"
            />
          </Field>
        </div>

        {/* Wallets */}
        <div className="flex flex-col gap-4 md:col-span-2">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Wallet mode">
              <Select
                value={form.walletMode}
                onChange={(e) => {
                  const mode = e.target.value as WalletMode;
                  const cap = MAX_WALLETS_PER_TASK[mode] ?? 1;
                  setForm((f) => ({ ...f, walletMode: mode, walletIds: f.walletIds.slice(0, cap) }));
                }}
              >
                <option value={WalletMode.Single}>Single (1)</option>
                <option value={WalletMode.SelfFunded}>Self-funded (unlimited)</option>
              </Select>
            </Field>
            <Field label="Quantity per wallet">
              <Input
                type="number"
                min={1}
                max={50}
                value={form.quantity}
                onChange={(e) => set('quantity', Number(e.target.value))}
              />
            </Field>
          </div>

          <div className="relative">
            <div className="mb-2 flex items-center justify-between">
              <span className="label">Select wallets</span>
              <span className="text-xs text-text-muted">
                {form.walletIds.length}
                {Number.isFinite(walletCap) ? `/${walletCap}` : ''} selected
              </span>
            </div>

            {/* Trigger */}
            <button
              type="button"
              onClick={() => setWalletMenuOpen((o) => !o)}
              className="input-base flex items-center justify-between gap-2 text-left"
            >
              <span className="truncate text-sm text-text-secondary">
                {form.walletIds.length === 0
                  ? 'Select wallets…'
                  : form.walletIds.length === (wallets.data?.length ?? 0)
                    ? `All wallets (${form.walletIds.length})`
                    : `${form.walletIds.length} wallet${form.walletIds.length > 1 ? 's' : ''} selected`}
              </span>
              <ChevronDown
                className={cn('size-4 shrink-0 text-text-muted transition-transform', walletMenuOpen && 'rotate-180')}
              />
            </button>

            {/* Dropdown */}
            {walletMenuOpen && (
              <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-[8px] border border-border bg-surface shadow-2xl">
                <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                  <Search className="size-4 shrink-0 text-text-muted" />
                  <input
                    value={walletSearch}
                    onChange={(e) => setWalletSearch(e.target.value)}
                    placeholder="Search label or address…"
                    className="w-full bg-transparent text-sm text-text-primary outline-none placeholder:text-text-muted"
                  />
                </div>
                <button
                  type="button"
                  onClick={toggleAllWallets}
                  className="flex w-full items-center gap-2 border-b border-border px-3 py-2 text-left text-sm text-accent transition-colors hover:bg-surface-2"
                >
                  <Check
                    className={cn('size-4', allVisibleSelected ? 'opacity-100' : 'opacity-30')}
                  />
                  Select all{walletSearch ? ' (filtered)' : ''}
                </button>
                <div className="max-h-48 overflow-y-auto">
                  {visibleWallets.map((wallet) => {
                    const selected = form.walletIds.includes(wallet.id);
                    return (
                      <button
                        key={wallet.id}
                        type="button"
                        onClick={() => toggleWallet(wallet.id)}
                        className={cn(
                          'flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-surface-2',
                          selected && 'bg-accent-subtle',
                        )}
                      >
                        <Check
                          className={cn('size-4 shrink-0 text-accent', selected ? 'opacity-100' : 'opacity-0')}
                        />
                        <span className="mono min-w-0 flex-1 truncate text-text-secondary">
                          {wallet.label ?? wallet.address}
                        </span>
                      </button>
                    );
                  })}
                  {visibleWallets.length === 0 && (
                    <p className="px-3 py-2 text-sm text-text-muted">No wallets match.</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Gas */}
        <div className="flex flex-col gap-4 md:col-span-2">
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Max fee ceiling (gwei)" hint="Reject if base fee is above this">
              <Input
                type="number"
                step="0.001"
                min="0.001"
                value={form.maxFeeGwei}
                onChange={(e) => set('maxFeeGwei', Number(e.target.value))}
              />
            </Field>
            <Field label="Priority tip (gwei)" hint="Must stay below the ceiling">
              <Input
                type="number"
                step="0.001"
                min="0"
                value={form.maxPriorityGwei}
                onChange={(e) => set('maxPriorityGwei', Number(e.target.value))}
              />
            </Field>
            <Field label="Gas limit per tx">
              <Input
                type="number"
                min="21000"
                max="2000000"
                value={form.gasLimit}
                onChange={(e) => set('gasLimit', Number(e.target.value))}
              />
            </Field>
          </div>
          {!gasValid && (
            <p className="text-sm text-danger">The priority tip must be below the fee ceiling.</p>
          )}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="label">RPC endpoints (optional)</span>
              <a href="/rpc" className="text-xs text-accent hover:underline">
                Manage
              </a>
            </div>
            <div className="grid max-h-32 gap-2 overflow-y-auto pr-1 md:grid-cols-2">
              {rpcEndpoints.data?.map((ep) => {
                const selected = selectedRpcIds.includes(ep.id);
                return (
                  <button
                    key={ep.id}
                    type="button"
                    onClick={() =>
                      setSelectedRpcIds((prev) =>
                        selected ? prev.filter((id) => id !== ep.id) : [...prev, ep.id],
                      )
                    }
                    className={cn(
                      'flex items-center justify-between gap-2 rounded-[8px] border px-3 py-2 text-left transition-colors',
                      selected
                        ? 'border-accent/50 bg-accent-subtle'
                        : 'border-border bg-surface-2 hover:border-text-muted',
                    )}
                  >
                    <span className="truncate text-xs">{ep.label}</span>
                    <span className="mono shrink-0 text-[11px] text-text-muted">
                      {ep.provider}
                      {ep.lastLatencyMs !== null ? ` ${ep.lastLatencyMs}ms` : ''}
                    </span>
                  </button>
                );
              })}
              {(rpcEndpoints.data?.length ?? 0) === 0 && (
                <p className="text-xs text-text-muted md:col-span-2">
                  No saved endpoints. Blank uses the chain defaults.
                </p>
              )}
            </div>
            <textarea
              className="input-base mt-2 min-h-14"
              value={customRpcs}
              onChange={(e) => setCustomRpcs(e.target.value)}
              placeholder={'Extra RPC URLs, one per line (optional)'}
            />
          </div>
        </div>

        {/* Timing */}
        <div className="grid gap-4 md:grid-cols-2 md:col-span-2">
          <Field label="Timing">
            <Select
              value={form.timingMode}
              onChange={(e) => set('timingMode', e.target.value as TimingMode)}
            >
              <option value={TimingMode.WaitForStage}>Wait for stage open (on-chain)</option>
              <option value={TimingMode.FireNow}>Fire now</option>
              <option value={TimingMode.CustomTime}>Custom time</option>
            </Select>
          </Field>
          {form.timingMode === TimingMode.CustomTime && (
            <Field label="Fire at" hint="At least 10 seconds from now">
              <Input
                type="datetime-local"
                value={form.customFireTime}
                onChange={(e) => set('customFireTime', e.target.value)}
              />
            </Field>
          )}
        </div>
      </div>

      <div className="mt-6 flex items-center justify-end gap-3 border-t border-border pt-4">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={!canSubmit} loading={create.isPending}>
          <Rocket className="size-4" aria-hidden />
          Schedule task
        </Button>
      </div>
    </Dialog>
  );
}
