'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ChevronDown, Check, Rocket, Search, Loader2, Sparkles } from 'lucide-react';
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
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface ResolvedCollectionMeta {
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

interface NewTaskForm {
  collection: string;
  chainKey: string;
  mintMode: MintMode;
  proxyGroup: string;
  quantity: number;
  pricePerNft: number;
  fundedOnly: boolean;
  walletIds: string[];
  flashbots: boolean;
  maxFeeGwei: string;
  maxPriorityGwei: string;
  gasLimit: string;
  nonce: string;
  timestamp: string;
  delayMs: number;
  simulate: boolean;
  spam: boolean;
  action: boolean;
}

/** Input with a right-aligned unit suffix (gwei, units, ms, etc.). */
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

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex items-center gap-2 text-left"
    >
      <span
        className={cn(
          'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
          checked ? 'bg-accent' : 'bg-border',
        )}
      >
        <span
          className={cn(
            'inline-block size-4 rounded-full bg-white transition-transform',
            checked ? 'translate-x-[18px]' : 'translate-x-0.5',
          )}
        />
      </span>
      <span className="text-sm text-text-secondary">{label}</span>
    </button>
  );
}

export function NewTaskDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [form, setForm] = useState<NewTaskForm>({
    collection: '',
    chainKey: '',
    mintMode: MintMode.Auto,
    proxyGroup: '',
    quantity: 1,
    pricePerNft: 0,
    fundedOnly: false,
    walletIds: [],
    flashbots: false,
    maxFeeGwei: '',
    maxPriorityGwei: '',
    gasLimit: '',
    nonce: '',
    timestamp: '',
    delayMs: 1000,
    simulate: false,
    spam: false,
    action: false,
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

  const resolvedMeta = useQuery({
    queryKey: ['resolve-collection-task', form.collection, form.chainKey],
    queryFn: () =>
      api.get<ResolvedCollectionMeta>(
        `/eligibility/resolve?input=${encodeURIComponent(form.collection.trim())}&chainKey=${form.chainKey || ''}`,
      ),
    enabled: form.collection.trim().length >= 3,
    staleTime: 60_000,
  });

  // Auto-set chain if detected from link
  useEffect(() => {
    if (resolvedMeta.data?.chainKey && !form.chainKey) {
      const match = chains.data?.find(
        (c) => c.key.toLowerCase() === resolvedMeta.data?.chainKey?.toLowerCase(),
      );
      if (match) setForm((f) => ({ ...f, chainKey: match.key }));
    }
  }, [resolvedMeta.data?.chainKey, chains.data, form.chainKey]);

  const create = useMutation({
    mutationFn: (input: CreateTaskInput) => api.post<TaskView>('/tasks', input),
    onSuccess: (task) => {
      toast.success(`Task "${task.name}" scheduled`);
      onClose();
      router.push(`/tasks/${task.id}`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const walletCap = MAX_WALLETS_PER_TASK[WalletMode.SelfFunded] ?? 1;

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
    const payload: CreateTaskInput = {
      name: form.collection.trim(),
      collection: form.collection.trim(),
      chainKey: form.chainKey,
      walletIds: form.walletIds,
      quantity: form.quantity,
      mintMode: form.mintMode,
      walletMode: WalletMode.SelfFunded,
      rpcUrls: [
        ...(rpcEndpoints.data ?? [])
          .filter((ep) => selectedRpcIds.includes(ep.id))
          .map((ep) => ep.url),
        ...customRpcs.split('\n').map((u) => u.trim()).filter((u) => u.startsWith('http')),
      ],
      timingMode: form.timestamp !== '' ? TimingMode.CustomTime : TimingMode.WaitForStage,
      customFireTime: null,
      pricePerNft: form.pricePerNft > 0 ? form.pricePerNft : null,
      proxyGroup: form.proxyGroup || null,
      fundedOnly: form.fundedOnly,
      flashbots: form.flashbots,
      nonce: form.nonce === '' ? null : Number(form.nonce),
      fireTimestamp: form.timestamp === '' ? null : Number(form.timestamp),
      delayMs: form.delayMs,
      simulate: form.simulate,
      spam: form.spam,
      action: form.action,
    };
    if (form.maxFeeGwei !== '') payload.maxFeeGwei = Number(form.maxFeeGwei);
    if (form.maxPriorityGwei !== '') payload.maxPriorityGwei = Number(form.maxPriorityGwei);
    if (form.gasLimit !== '') payload.gasLimit = Number(form.gasLimit);
    create.mutate(payload);
  };

  const collectionValid = form.collection.trim().length > 1 && form.chainKey !== '';
  const walletsValid = form.walletIds.length > 0 && form.quantity >= 1;
  const fee = form.maxFeeGwei === '' ? NaN : Number(form.maxFeeGwei);
  const prio = form.maxPriorityGwei === '' ? NaN : Number(form.maxPriorityGwei);
  const gasValid = Number.isNaN(fee) || Number.isNaN(prio) || (prio < fee && fee > 0);
  const canSubmit = collectionValid && walletsValid && gasValid && !create.isPending;

  return (
    <Dialog open={open} onClose={onClose} title="Create Task" size="xl">
      <div className="grid grid-cols-12 gap-4">
        {/* Contract Address / Launchpad Link */}
        <div className="col-span-12">
          <Field
            label="Contract Address / Launchpad Link"
            hint="Contract address (0x...), OpenSea URL, or collection slug (Auto-detected)"
          >
            <div className="relative">
              <Input
                value={form.collection}
                onChange={(e) => set('collection', e.target.value)}
                placeholder="0x... or https://opensea.io/collection/the-plimpo/ or slug"
                className="mono pr-8"
              />
              {resolvedMeta.isFetching && (
                <div className="absolute right-2.5 top-2.5">
                  <Loader2 className="size-4 animate-spin text-accent" />
                </div>
              )}
            </div>
          </Field>

          {/* NFT / Collection Preview Card */}
          {resolvedMeta.data && (resolvedMeta.data.name || resolvedMeta.data.imageUrl || resolvedMeta.data.symbol) && (
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
        </div>

        {/* Chain + Mint Phase */}
        <div className="col-span-12 sm:col-span-6">
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
        <div className="col-span-12 sm:col-span-6">
          <Field label="Mint Phase">
            <Select
              value={form.mintMode}
              onChange={(e) => set('mintMode', e.target.value as MintMode)}
            >
              <option value={MintMode.Public}>Public</option>
              <option value={MintMode.Allowlist}>Allowlist</option>
              <option value={MintMode.Fcfs}>FCFS</option>
              <option value={MintMode.Auto}>Auto detect</option>
            </Select>
          </Field>
        </div>

        {/* Proxy Group + NFT Amount + Price per NFT */}
        <div className="col-span-12 sm:col-span-4">
          <Field label="Proxy Group">
            <Select value={form.proxyGroup} onChange={(e) => set('proxyGroup', e.target.value)}>
              <option value="">(no proxy)</option>
            </Select>
          </Field>
        </div>
        <div className="col-span-6 sm:col-span-4">
          <Field label="NFT Amount" hint="Per wallet (max 50)">
            <Input
              type="number"
              min={1}
              max={50}
              value={form.quantity}
              onChange={(e) => set('quantity', Number(e.target.value))}
            />
          </Field>
        </div>
        <div className="col-span-6 sm:col-span-4">
          <Field label="Price per NFT" hint="Optional, informational">
            <Input
              type="number"
              min={0}
              step="0.000001"
              value={form.pricePerNft}
              onChange={(e) => set('pricePerNft', Number(e.target.value))}
              placeholder="0"
            />
          </Field>
        </div>

        {/* Funded Only + Wallets */}
        <div className="col-span-12 sm:col-span-4">
          <div className="mb-2 flex h-9 items-center">
            <Toggle
              checked={form.fundedOnly}
              onChange={(v) => set('fundedOnly', v)}
              label="Funded Only"
            />
          </div>
        </div>
        <div className="col-span-12 sm:col-span-8">
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

        {/* Flashbots + RPC Endpoints */}
        <div className="col-span-12 sm:col-span-4">
          <div className="mb-2 flex h-9 items-center">
            <Toggle checked={form.flashbots} onChange={(v) => set('flashbots', v)} label="Flashbots" />
          </div>
        </div>
        <div className="col-span-12 sm:col-span-8">
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

        {/* Gas Limit + Max Fee + Priority Fee */}
        <div className="col-span-12 sm:col-span-4">
          <Field label="Gas Limit">
            <UnitInput
              unit="units"
              type="number"
              min={21000}
              max={2000000}
              value={form.gasLimit}
              onChange={(e) => set('gasLimit', e.target.value)}
              placeholder="auto"
            />
          </Field>
        </div>
        <div className="col-span-12 sm:col-span-4">
          <Field label="Max Fee">
            <UnitInput
              unit="gwei"
              type="number"
              step="0.001"
              min="0.001"
              value={form.maxFeeGwei}
              onChange={(e) => set('maxFeeGwei', e.target.value)}
              placeholder="auto"
            />
          </Field>
        </div>
        <div className="col-span-12 sm:col-span-4">
          <Field label="Priority Fee">
            <UnitInput
              unit="gwei"
              type="number"
              step="0.001"
              min="0"
              value={form.maxPriorityGwei}
              onChange={(e) => set('maxPriorityGwei', e.target.value)}
              placeholder="auto"
            />
          </Field>
        </div>
        {!gasValid && (
          <p className="col-span-12 text-sm text-danger">
            The priority fee must be below the fee ceiling.
          </p>
        )}

        {/* Nonce + Timestamp + Delay */}
        <div className="col-span-12 sm:col-span-4">
          <Field label="Nonce">
            <Input
              type="number"
              min={0}
              value={form.nonce}
              onChange={(e) => set('nonce', e.target.value)}
              placeholder="auto"
            />
          </Field>
        </div>
        <div className="col-span-12 sm:col-span-4">
          <Field label="Timestamp" hint="Unix seconds">
            <Input
              type="number"
              min={0}
              value={form.timestamp}
              onChange={(e) => set('timestamp', e.target.value)}
              placeholder="now"
            />
          </Field>
        </div>
        <div className="col-span-12 sm:col-span-4">
          <Field label="Delay">
            <UnitInput
              unit="ms"
              type="number"
              min={0}
              value={form.delayMs}
              onChange={(e) => set('delayMs', Number(e.target.value))}
            />
          </Field>
        </div>

        {/* Simulate / Spam / Action */}
        <div className="col-span-12 flex flex-wrap items-center gap-6">
          <Toggle checked={form.simulate} onChange={(v) => set('simulate', v)} label="Simulate" />
          <Toggle checked={form.spam} onChange={(v) => set('spam', v)} label="Spam" />
          <Toggle checked={form.action} onChange={(v) => set('action', v)} label="Action" />
        </div>
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
