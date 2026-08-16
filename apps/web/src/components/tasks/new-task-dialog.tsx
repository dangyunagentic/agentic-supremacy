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

/** Input with a right-aligned unit suffix (gwei, units, etc.). */
function UnitInput({
  unit,
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { unit: string }) {
  return (
    <div className="relative">
      <input {...props} className={cn('input-base pr-14', className)} />
      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-text-muted">
        {unit}
      </span>
    </div>
  );
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
  const [rpcMenuOpen, setRpcMenuOpen] = useState(false);
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

  // RPC selection: "All endpoints" means selectedRpcIds empty → fall back to chain defaults.
  const allRpcSelected = selectedRpcIds.length === 0;

  const submit = () => {
    create.mutate({
      name: form.name.trim() || form.collection,
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

  const collectionValid = form.collection.trim().length > 1 && form.chainKey !== '';
  const walletsValid = form.walletIds.length > 0 && form.walletIds.length <= walletCap && form.quantity >= 1;
  const canSubmit = collectionValid && walletsValid && gasValid && form.gasLimit >= 21000 && timingValid;

  return (
    <Dialog open={open} onClose={onClose} title="Create Task" size="xl">
      <div className="grid grid-cols-12 gap-4">
        {/* Task name */}
        <div className="col-span-12">
          <Field label="Task name">
            <Input
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="Bored Apes public mint (auto from collection if blank)"
            />
          </Field>
        </div>

        {/* Row 1: Contract / Launchpad link + Chain */}
        <div className="col-span-12 lg:col-span-9">
          <Field
            label="Contract Address / Launchpad Link"
            hint="Contract address (public mints) or OpenSea slug / URL (allowlist & FCFS)"
          >
            <Input
              value={form.collection}
              onChange={(e) => set('collection', e.target.value)}
              placeholder="0x... or https://opensea.io/collection/the-plimpo/"
              className="mono"
            />
          </Field>
        </div>
        <div className="col-span-12 lg:col-span-3">
          <Field label="Chain">
            <Select value={form.chainKey} onChange={(e) => set('chainKey', e.target.value)}>
              <option value="">Select chain</option>
              {chains.data?.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.name} ({c.nativeSymbol})
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {/* Row 2: Mint Phase (full width) */}
        <div className="col-span-12">
          <Field label="Mint Phase" hint="Auto resolves the live stage from the chain">
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

        {/* Row 3: Wallet mode + NFT amount */}
        <div className="col-span-12 sm:col-span-6">
          <Field label="Wallet Mode">
            <Select
              value={form.walletMode}
              onChange={(e) => {
                const mode = e.target.value as WalletMode;
                const cap = MAX_WALLETS_PER_TASK[mode] ?? 1;
                setForm((f) => ({ ...f, walletMode: mode, walletIds: f.walletIds.slice(0, cap) }));
              }}
            >
              <option value={WalletMode.SelfFunded}>Self-funded (unlimited)</option>
              <option value={WalletMode.Single}>Single (1)</option>
            </Select>
          </Field>
        </div>
        <div className="col-span-12 sm:col-span-6">
          <Field label="NFT Amount" hint="Mints per wallet (max 50)">
            <Input
              type="number"
              min={1}
              max={50}
              value={form.quantity}
              onChange={(e) => set('quantity', Number(e.target.value))}
            />
          </Field>
        </div>

        {/* Row 4: Wallets (full width) */}
        <div className="col-span-12">
          <div className="mb-2 flex items-center justify-between">
            <span className="label">Wallets</span>
            <span className="text-xs text-text-muted">
              {form.walletIds.length}
              {Number.isFinite(walletCap) ? `/${walletCap}` : ''} selected
            </span>
          </div>
          <div className="relative">
            <button
              type="button"
              onClick={() => setWalletMenuOpen((o) => !o)}
              className="input-base flex items-center justify-between gap-2 text-left"
            >
              <span className="truncate text-sm text-text-secondary">
                {form.walletIds.length === 0
                  ? 'Select wallets'
                  : form.walletIds.length === (wallets.data?.length ?? 0)
                    ? `All wallets (${form.walletIds.length})`
                    : `${form.walletIds.length} wallet${form.walletIds.length > 1 ? 's' : ''} selected`}
              </span>
              <ChevronDown
                className={cn('size-4 shrink-0 text-text-muted transition-transform', walletMenuOpen && 'rotate-180')}
              />
            </button>
            {walletMenuOpen && (
              <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-[8px] border border-border bg-surface shadow-2xl">
                <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                  <Search className="size-4 shrink-0 text-text-muted" />
                  <input
                    value={walletSearch}
                    onChange={(e) => setWalletSearch(e.target.value)}
                    placeholder="Search label or address"
                    className="w-full bg-transparent text-sm text-text-primary outline-none placeholder:text-text-muted"
                  />
                </div>
                <button
                  type="button"
                  onClick={toggleAllWallets}
                  className="flex w-full items-center gap-2 border-b border-border px-3 py-2 text-left text-sm text-accent transition-colors hover:bg-surface-2"
                >
                  <Check className={cn('size-4', allVisibleSelected ? 'opacity-100' : 'opacity-30')} />
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
                        <Check className={cn('size-4 shrink-0 text-accent', selected ? 'opacity-100' : 'opacity-0')} />
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

        {/* Row 5: RPC Endpoints (full width) */}
        <div className="col-span-12">
          <div className="mb-2 flex items-center justify-between">
            <span className="label">RPC Endpoints</span>
            <a href="/rpc" className="text-xs text-accent hover:underline">
              Manage
            </a>
          </div>
          <div className="relative">
            <button
              type="button"
              onClick={() => setRpcMenuOpen((o) => !o)}
              className="input-base flex items-center justify-between gap-2 text-left"
            >
              <span className="truncate text-sm text-text-secondary">
                {allRpcSelected
                  ? `All ${rpcEndpoints.data?.length ?? 0} endpoints`
                  : `${selectedRpcIds.length} endpoint${selectedRpcIds.length > 1 ? 's' : ''} selected`}
              </span>
              <ChevronDown
                className={cn('size-4 shrink-0 text-text-muted transition-transform', rpcMenuOpen && 'rotate-180')}
              />
            </button>
            {rpcMenuOpen && (
              <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-[8px] border border-border bg-surface shadow-2xl">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedRpcIds([]);
                    setRpcMenuOpen(false);
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 border-b border-border px-3 py-2 text-left text-sm transition-colors hover:bg-surface-2',
                    allRpcSelected && 'bg-accent-subtle text-accent',
                  )}
                >
                  <Check className={cn('size-4 text-accent', allRpcSelected ? 'opacity-100' : 'opacity-0')} />
                  All endpoints (chain defaults)
                </button>
                <div className="max-h-48 overflow-y-auto">
                  {rpcEndpoints.data?.map((ep) => {
                    const selected = selectedRpcIds.includes(ep.id);
                    return (
                      <button
                        key={ep.id}
                        type="button"
                        onClick={() => {
                          setSelectedRpcIds((prev) => {
                            const next = selected ? prev.filter((id) => id !== ep.id) : [...prev, ep.id];
                            return next.length === (rpcEndpoints.data?.length ?? 0) ? [] : next;
                          });
                        }}
                        className={cn(
                          'flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition-colors hover:bg-surface-2',
                          selected && 'bg-accent-subtle',
                        )}
                      >
                        <span className="flex items-center gap-2">
                          <Check className={cn('size-4 text-accent', selected ? 'opacity-100' : 'opacity-0')} />
                          <span className="truncate text-sm text-text-secondary">{ep.label}</span>
                        </span>
                        <span className="mono shrink-0 text-[11px] text-text-muted">
                          {ep.provider}
                          {ep.lastLatencyMs !== null ? ` ${ep.lastLatencyMs}ms` : ''}
                        </span>
                      </button>
                    );
                  })}
                  {(rpcEndpoints.data?.length ?? 0) === 0 && (
                    <p className="px-3 py-2 text-sm text-text-muted">No saved endpoints for this chain.</p>
                  )}
                </div>
              </div>
            )}
          </div>
          <textarea
            className="input-base mt-2 min-h-12"
            value={customRpcs}
            onChange={(e) => setCustomRpcs(e.target.value)}
            placeholder="Extra RPC URLs, one per line (optional)"
          />
        </div>

        {/* Row 6: Gas Limit + Max Fee + Priority Fee */}
        <div className="col-span-12 sm:col-span-4">
          <Field label="Gas Limit" hint="Required">
            <UnitInput
              unit="units"
              type="number"
              min={21000}
              max={2000000}
              value={form.gasLimit}
              onChange={(e) => set('gasLimit', Number(e.target.value))}
            />
          </Field>
        </div>
        <div className="col-span-12 sm:col-span-4">
          <Field label="Max Fee" hint="Reject if base fee is above this">
            <UnitInput
              unit="gwei"
              type="number"
              step="0.001"
              min="0.001"
              value={form.maxFeeGwei}
              onChange={(e) => set('maxFeeGwei', Number(e.target.value))}
            />
          </Field>
        </div>
        <div className="col-span-12 sm:col-span-4">
          <Field label="Priority Fee" hint="Must stay below the ceiling">
            <UnitInput
              unit="gwei"
              type="number"
              step="0.001"
              min="0"
              value={form.maxPriorityGwei}
              onChange={(e) => set('maxPriorityGwei', Number(e.target.value))}
            />
          </Field>
        </div>
        {!gasValid && (
          <p className="col-span-12 text-sm text-danger">
            The priority fee must be below the fee ceiling.
          </p>
        )}

        {/* Row 7: Timing */}
        <div className="col-span-12 sm:col-span-6">
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
        </div>
        {form.timingMode === TimingMode.CustomTime && (
          <div className="col-span-12 sm:col-span-6">
            <Field label="Fire at" hint="At least 10 seconds from now">
              <Input
                type="datetime-local"
                value={form.customFireTime}
                onChange={(e) => set('customFireTime', e.target.value)}
              />
            </Field>
          </div>
        )}
      </div>

      <div className="mt-6 flex items-center justify-end gap-3 border-t border-border pt-4">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={!canSubmit} loading={create.isPending}>
          <Rocket className="size-4" aria-hidden />
          Create
        </Button>
      </div>
    </Dialog>
  );
}
