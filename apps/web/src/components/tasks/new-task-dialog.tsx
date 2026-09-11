'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ChevronDown,
  Check,
  Rocket,
  Search,
  Loader2,
  Sparkles,
  ShieldCheck,
  Filter,
} from 'lucide-react';
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
  type EligibilityReport,
} from '@mintbot/shared';
import { api } from '@/lib/api';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
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
  dropStartTime?: number | null;
  dropEndTime?: number | null;
  mintPriceWei?: string | null;
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
  maxTx: string;
  earlyFireMs: number;
  simulate: boolean;
  spam: boolean;
  action: boolean;
}

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
    maxTx: '',
    earlyFireMs: 0,
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

  // Auto-fill timestamp from on-chain drop start time (paste CA/link → done)
  useEffect(() => {
    const start = resolvedMeta.data?.dropStartTime;
    if (start && start > 0 && !form.timestamp) {
      setForm((f) => ({ ...f, timestamp: String(start) }));
    }
  }, [resolvedMeta.data?.dropStartTime, form.timestamp]);

  // ── Live Eligibility Check (only checks SELECTED wallets) ──
  const eligibilityMutation = useMutation({
    mutationFn: () => {
      // Only check the wallets the user has selected in this form
      const selectedWalletIds = form.walletIds.length > 0 ? form.walletIds : [];
      return api.post<EligibilityReport>('/eligibility/check', {
        collection: form.collection.trim(),
        chainKey: form.chainKey || 'base',
        walletIds: selectedWalletIds,
        quantity: form.quantity || 1,
      });
    },
    onSuccess: (data) => {
      const eligibleAddrs = new Set(
        (data.wallets ?? []).filter((w) => w.eligible).map((w) => w.address.toLowerCase()),
      );
      const eligibleWalletIds = (wallets.data ?? [])
        .filter((w) => eligibleAddrs.has(w.address.toLowerCase()))
        .map((w) => w.id);

      if (eligibleWalletIds.length > 0) {
        toast.success(`Found ${eligibleWalletIds.length} eligible / whitelisted wallet(s)!`);
      } else {
        toast.info('No wallets are whitelisted for this drop stage');
      }
    },
    onError: (err: Error) => toast.error(`Eligibility check failed: ${err.message}`),
  });

  const eligReport = eligibilityMutation.data;
  const eligibleAddressMap = new Map<string, { eligible: boolean; reason: string }>();
  if (eligReport?.wallets) {
    for (const w of eligReport.wallets) {
      eligibleAddressMap.set(w.address.toLowerCase(), {
        eligible: w.eligible,
        reason: w.reason,
      });
    }
  }

  const eligibleCount =
    (wallets.data ?? []).filter((w) => eligibleAddressMap.get(w.address.toLowerCase())?.eligible)
      .length;

  // Auto select eligible only
  const handleSelectEligibleOnly = () => {
    if (!eligReport?.wallets) return;
    const eligibleAddrs = new Set(
      eligReport.wallets.filter((w) => w.eligible).map((w) => w.address.toLowerCase()),
    );
    const eligibleIds = (wallets.data ?? [])
      .filter((w) => eligibleAddrs.has(w.address.toLowerCase()))
      .map((w) => w.id);

    if (eligibleIds.length > 0) {
      setForm((f) => ({ ...f, walletIds: eligibleIds }));
      toast.success(`Selected ${eligibleIds.length} whitelisted wallet(s)`);
    } else {
      toast.error('No eligible wallets found to select');
    }
  };

  const create = useMutation({
    mutationFn: (input: CreateTaskInput) => api.post<TaskView>('/tasks', input),
    onSuccess: (task) => {
      toast.success(`Task "${task.name}" scheduled`);
      onClose();
      router.push(`/tasks/${task.id}`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const set = <K extends keyof NewTaskForm>(key: K, value: NewTaskForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const toggleWallet = (id: string) => {
    setForm((f) => {
      const exists = f.walletIds.includes(id);
      return {
        ...f,
        walletIds: exists ? f.walletIds.filter((w) => w !== id) : [...f.walletIds, id],
      };
    });
  };

  const visibleWallets = (wallets.data ?? []).filter((w) => {
    if (!walletSearch) return true;
    const s = walletSearch.toLowerCase();
    return w.address.toLowerCase().includes(s) || (w.label && w.label.toLowerCase().includes(s));
  });

  const allVisibleSelected =
    visibleWallets.length > 0 && visibleWallets.every((w) => form.walletIds.includes(w.id));

  const toggleAllWallets = () => {
    if (allVisibleSelected) {
      const visibleIds = new Set(visibleWallets.map((w) => w.id));
      setForm((f) => ({ ...f, walletIds: f.walletIds.filter((id) => !visibleIds.has(id)) }));
    } else {
      const combined = Array.from(
        new Set([...form.walletIds, ...visibleWallets.map((w) => w.id)]),
      );
      setForm((f) => ({ ...f, walletIds: combined }));
    }
  };

  const toggleRpc = (id: string) => {
    setSelectedRpcIds((prev) =>
      prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id],
    );
  };

  const toggleAllRpcs = () => {
    const allIds = (rpcEndpoints.data ?? []).map((r) => r.id);
    setSelectedRpcIds((prev) => (prev.length === allIds.length ? [] : allIds));
  };

  const walletCap = MAX_WALLETS_PER_TASK[WalletMode.SelfFunded];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload: CreateTaskInput = {
      name:
        resolvedMeta.data?.name ||
        (form.collection.startsWith('0x')
          ? `${form.collection.slice(0, 6)}...${form.collection.slice(-4)}`
          : form.collection.trim()),
      collection: form.collection.trim(),
      chainKey: form.chainKey,
      mintMode: form.mintMode,
      walletMode: WalletMode.SelfFunded,
      walletIds: form.walletIds,
      quantity: Number(form.quantity),
      rpcUrls: [
        ...(rpcEndpoints.data ?? [])
          .filter((ep) => selectedRpcIds.includes(ep.id))
          .map((ep) => ep.url),
        ...customRpcs.split('\n').map((u) => u.trim()).filter((u) => /^(https?|wss?):\/\//.test(u)),
      ],
      timingMode: form.timestamp !== '' ? TimingMode.CustomTime : TimingMode.WaitForStage,
      customFireTime: null,
      pricePerNft: form.pricePerNft != null && !Number.isNaN(form.pricePerNft) ? Number(form.pricePerNft) : null,
      proxyGroup: form.proxyGroup || null,
      fundedOnly: form.fundedOnly,
      flashbots: form.flashbots,
      nonce: form.nonce === '' ? null : Number(form.nonce),
      fireTimestamp: form.timestamp === '' ? null : Number(form.timestamp),
      delayMs: form.delayMs,
      maxTx: form.maxTx === '' ? null : Number(form.maxTx),
      earlyFireMs: form.earlyFireMs,
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
  const gasValid = Number.isNaN(fee) || Number.isNaN(prio) || prio <= fee;
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

          {/* NFT / Collection Preview Card with Live Check Button */}
          {resolvedMeta.data && (resolvedMeta.data.name || resolvedMeta.data.imageUrl || resolvedMeta.data.symbol) && (
            <div className="mt-3 flex items-center justify-between gap-3 rounded-[8px] border border-accent/30 bg-accent-subtle/50 p-3">
              <div className="flex items-center gap-3 min-w-0">
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
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm text-text-primary truncate">
                      {resolvedMeta.data.name || 'NFT Collection'}
                    </span>
                    {resolvedMeta.data.symbol && (
                      <Badge tone="neutral" className="text-[10px] uppercase">
                        {resolvedMeta.data.symbol}
                      </Badge>
                    )}
                    <Badge tone="accent" className="text-[10px] uppercase">
                      {resolvedMeta.data.source}
                    </Badge>
                  </div>
                  <p className="mono text-xs text-text-muted truncate">
                    {resolvedMeta.data.contractAddress || form.collection}
                  </p>
                </div>
              </div>

              {/* Check Eligibility Button inside Card */}
              <Button
                size="sm"
                variant="secondary"
                onClick={() => eligibilityMutation.mutate()}
                loading={eligibilityMutation.isPending}
                disabled={!form.collection.trim() || form.walletIds.length === 0}
                className="shrink-0 gap-1.5 text-xs font-semibold"
                title={form.walletIds.length === 0 ? 'Select at least one wallet first' : undefined}
              >
                <ShieldCheck className="size-3.5 text-accent" />
                Check WL Eligibility
              </Button>
            </div>
          )}

          {/* Eligibility Results Alert Banner */}
          {eligReport && (
            <div className="mt-3 rounded-[8px] border border-border bg-surface-2 p-3 text-xs space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-text-primary">Whitelist Scan:</span>
                  <Badge tone={eligibleCount > 0 ? 'success' : 'danger'}>
                    {eligibleCount} / {form.walletIds.length || (wallets.data ?? []).length} Wallets Whitelisted
                  </Badge>
                  <span className="text-text-muted uppercase">
                    (Mode: {eligReport.mode}{eligReport.stageName ? ` · ${eligReport.stageName}` : ''}{eligReport.mintPrice ? ` · ${eligReport.mintPrice} ETH` : ''})
                  </span>
                </div>
                {eligibleCount > 0 && (
                  <Button
                    size="sm"
                    variant="primary"
                    className="h-7 text-xs gap-1"
                    onClick={handleSelectEligibleOnly}
                  >
                    <Filter className="size-3" />
                    Select {eligibleCount} Eligible Wallet(s)
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Chain & Mint Phase */}
        <div className="col-span-12 sm:col-span-6">
          <Field label="Chain">
            <select
              value={form.chainKey}
              onChange={(e) => set('chainKey', e.target.value)}
              className="input-base w-full"
            >
              <option value="">Select chain...</option>
              {(chains.data ?? []).map((c) => (
                <option key={c.key} value={c.key}>
                  {c.name} ({c.key})
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="col-span-12 sm:col-span-6">
          <Field label="Mint Phase">
            <select
              value={form.mintMode}
              onChange={(e) => set('mintMode', e.target.value as MintMode)}
              className="input-base w-full"
            >
              <option value={MintMode.Auto}>Auto detect</option>
              <option value={MintMode.Public}>Public</option>
              <option value={MintMode.Allowlist}>Allowlist (GTD)</option>
              <option value={MintMode.Fcfs}>FCFS</option>
            </select>
          </Field>
        </div>

        {/* Proxy Group & Quantity */}
        <div className="col-span-12 sm:col-span-4">
          <Field label="Proxy Group" hint="Optional">
            <Input
              value={form.proxyGroup}
              onChange={(e) => set('proxyGroup', e.target.value)}
              placeholder="e.g. residential-1"
            />
          </Field>
        </div>
        <div className="col-span-6 sm:col-span-4">
          <Field label="NFT Quantity per Wallet">
            <Input
              type="number"
              min={1}
              value={form.quantity}
              onChange={(e) => set('quantity', Math.max(1, Number(e.target.value)))}
            />
          </Field>
        </div>
        <div className="col-span-6 sm:col-span-4">
          <Field
            label="Price per NFT (ETH)"
            hint="Set 0 for Free Mint (Auto-aborts if developer changes price to paid)"
          >
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

        {/* Funded Only + Wallets Selection */}
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
            <div className="flex items-center gap-2">
              {eligibleCount > 0 && (
                <button
                  type="button"
                  onClick={handleSelectEligibleOnly}
                  className="text-xs text-success font-semibold hover:underline"
                >
                  Select WL only ({eligibleCount})
                </button>
              )}
              <span className="text-xs text-text-muted">
                {form.walletIds.length}
                {Number.isFinite(walletCap) ? `/${walletCap}` : ''} selected
              </span>
            </div>
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
                <div className="flex items-center justify-between border-b border-border px-3 py-2 text-xs">
                  <button
                    type="button"
                    onClick={toggleAllWallets}
                    className="text-accent font-semibold hover:underline"
                  >
                    {allVisibleSelected ? 'Deselect all' : 'Select all'}
                  </button>
                  {eligibleCount > 0 && (
                    <button
                      type="button"
                      onClick={handleSelectEligibleOnly}
                      className="text-success font-semibold hover:underline"
                    >
                      Select {eligibleCount} Eligible Only
                    </button>
                  )}
                </div>
                <div className="max-h-56 overflow-y-auto">
                  {visibleWallets.map((wallet) => {
                    const selected = form.walletIds.includes(wallet.id);
                    const elig = eligibleAddressMap.get(wallet.address.toLowerCase());

                    return (
                      <button
                        key={wallet.id}
                        type="button"
                        onClick={() => toggleWallet(wallet.id)}
                        className={cn(
                          'flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-surface-2',
                          selected && 'bg-accent-subtle',
                          elig?.eligible && 'border-l-2 border-success',
                        )}
                      >
                        <Check className={cn('size-4 shrink-0 text-accent', selected ? 'opacity-100' : 'opacity-0')} />
                        <div className="min-w-0 flex-1 flex items-center justify-between gap-2">
                          <span className="mono truncate text-text-secondary text-xs">
                            {wallet.label ? `${wallet.label} · ` : ''}{wallet.address.slice(0, 6)}...{wallet.address.slice(-4)}
                          </span>
                          {elig && (
                            <span className="shrink-0">
                              {elig.eligible ? (
                                <Badge tone="success" className="text-[9px] px-1.5 py-0">
                                  WHITELISTED
                                </Badge>
                              ) : (
                                <span className="text-[9px] text-text-muted">Not WL</span>
                              )}
                            </span>
                          )}
                        </div>
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
            <span className="text-xs text-text-muted">
              {selectedRpcIds.length} selected
              {customRpcs.split('\n').filter((u) => /^(https?|wss?):\/\//.test(u.trim())).length > 0 &&
                ` + ${customRpcs.split('\n').filter((u) => /^(https?|wss?):\/\//.test(u.trim())).length} custom`}
            </span>
          </div>
          <div className="relative">
            <button
              type="button"
              onClick={() => setRpcMenuOpen((o) => !o)}
              className="input-base flex items-center justify-between gap-2 text-left"
            >
              <span className="truncate text-sm text-text-secondary">
                {selectedRpcIds.length === 0 && !customRpcs.trim()
                  ? 'Default system RPC'
                  : `${selectedRpcIds.length} saved RPCs selected`}
              </span>
              <ChevronDown
                className={cn('size-4 shrink-0 text-text-muted transition-transform', rpcMenuOpen && 'rotate-180')}
              />
            </button>
            {rpcMenuOpen && (
              <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-[8px] border border-border bg-surface shadow-2xl">
                <button
                  type="button"
                  onClick={toggleAllRpcs}
                  className="flex w-full items-center gap-2 border-b border-border px-3 py-2 text-left text-sm text-accent transition-colors hover:bg-surface-2"
                >
                  <Check
                    className={cn(
                      'size-4',
                      selectedRpcIds.length === (rpcEndpoints.data?.length ?? 0) ? 'opacity-100' : 'opacity-30',
                    )}
                  />
                  Select all
                </button>
                <div className="max-h-48 overflow-y-auto">
                  {(rpcEndpoints.data ?? []).map((ep) => {
                    const selected = selectedRpcIds.includes(ep.id);
                    return (
                      <button
                        key={ep.id}
                        type="button"
                        onClick={() => toggleRpc(ep.id)}
                        className={cn(
                          'flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-surface-2',
                          selected && 'bg-accent-subtle',
                        )}
                      >
                        <Check className={cn('size-4 shrink-0 text-accent', selected ? 'opacity-100' : 'opacity-0')} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm text-text-primary">{ep.url}</p>
                          <p className="mono truncate text-xs text-text-muted">{ep.chainKey}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Gas Settings */}
        <div className="col-span-12 sm:col-span-4">
          <Field label="Gas Limit" hint="Auto if empty">
            <UnitInput
              unit="units"
              value={form.gasLimit}
              onChange={(e) => set('gasLimit', e.target.value)}
              placeholder="e.g. 150000"
            />
          </Field>
        </div>
        <div className="col-span-6 sm:col-span-4">
          <Field label="Max Fee" hint="Auto if empty">
            <UnitInput
              unit="gwei"
              value={form.maxFeeGwei}
              onChange={(e) => set('maxFeeGwei', e.target.value)}
              placeholder="e.g. 0.05"
            />
          </Field>
        </div>
        <div className="col-span-6 sm:col-span-4">
          <Field label="Priority Fee" hint="Auto if empty">
            <UnitInput
              unit="gwei"
              value={form.maxPriorityGwei}
              onChange={(e) => set('maxPriorityGwei', e.target.value)}
              placeholder="e.g. 0.001"
            />
          </Field>
        </div>

        {/* Execution / Speed Settings */}
        <div className="col-span-12 grid grid-cols-12 gap-3 border-t border-border pt-4">
          <div className="col-span-6 sm:col-span-3">
            <Field label="Max Tx" hint="Empty = unlimited">
              <UnitInput
                unit="tx"
                value={form.maxTx}
                onChange={(e) => set('maxTx', e.target.value)}
                placeholder="e.g. 50"
              />
            </Field>
          </div>
          <div className="col-span-6 sm:col-span-3">
            <Field label="Timestamp" hint="Unix seconds (start)">
              <UnitInput
                unit="s"
                value={form.timestamp}
                onChange={(e) => set('timestamp', e.target.value)}
                placeholder="e.g. 1787954395"
              />
            </Field>
          </div>
          <div className="col-span-6 sm:col-span-3">
            <Field label="Delay" hint="Between wallets (ms)">
              <UnitInput
                unit="ms"
                value={form.delayMs}
                onChange={(e) => set('delayMs', Math.max(0, Number(e.target.value)))}
                placeholder="e.g. 500"
              />
            </Field>
          </div>
          <div className="col-span-6 sm:col-span-3">
            <Field label="Early Fire" hint="Blast X ms BEFORE T-0 (fast mint)">
              <UnitInput
                unit="ms"
                value={form.earlyFireMs}
                onChange={(e) => set('earlyFireMs', Math.min(5000, Math.max(0, Number(e.target.value))))}
                placeholder="e.g. 400"
              />
            </Field>
          </div>
        </div>

        {/* Advanced Execution Settings */}
        <div className="col-span-12 grid grid-cols-12 gap-3 border-t border-border pt-4">
          <div className="col-span-6 sm:col-span-3">
            <Toggle checked={form.spam} onChange={(v) => set('spam', v)} label="Spam (Re-blast)" />
          </div>
          <div className="col-span-6 sm:col-span-3">
            <Toggle checked={form.action} onChange={(v) => set('action', v)} label="Action (Signed WL)" />
          </div>
          <div className="col-span-6 sm:col-span-3">
            <Toggle checked={form.simulate} onChange={(v) => set('simulate', v)} label="Simulate (Dry-run)" />
          </div>
        </div>
      </div>

      <div className="mt-6 flex items-center justify-end gap-3 border-t border-border pt-4">
        <Button variant="secondary" onClick={onClose} disabled={create.isPending}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} loading={create.isPending} disabled={!canSubmit}>
          <Rocket className="size-4" aria-hidden />
          Create Task
        </Button>
      </div>
    </Dialog>
  );
}
