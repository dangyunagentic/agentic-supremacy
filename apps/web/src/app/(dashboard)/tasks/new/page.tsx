'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, ArrowRight, Rocket } from 'lucide-react';
import {
  MintMode,
  TimingMode,
  WalletMode,
  MAX_WALLETS_PER_TASK,
  type ChainView,
  type CreateTaskInput,
  type Paginated,
  type RpcEndpointView,
  type TaskView,
  type WalletView,
} from '@mintbot/shared';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const STEPS = ['Collection', 'Wallets', 'Gas', 'Timing', 'Confirm'] as const;

interface WizardForm {
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
  recipientAddress: string;
}

export default function NewTaskPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<WizardForm>({
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
    recipientAddress: '',
  });
  const [selectedRpcIds, setSelectedRpcIds] = useState<string[]>([]);
  const [customRpcs, setCustomRpcs] = useState('');

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
      router.push(`/tasks/${task.id}`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const walletCap = MAX_WALLETS_PER_TASK[form.walletMode] ?? 1;
  const gasValid = form.maxPriorityGwei < form.maxFeeGwei && form.maxFeeGwei > 0;
  const timingValid =
    form.timingMode !== TimingMode.CustomTime || new Date(form.customFireTime).getTime() > Date.now() + 10_000;
  const stepValid =
    step === 0
      ? form.name.trim().length > 0 && form.collection.trim().length > 1 && form.chainKey !== ''
      : step === 1
        ? form.walletIds.length > 0 && form.walletIds.length <= walletCap && form.quantity >= 1
        : step === 2
          ? gasValid && form.gasLimit >= 21000
          : step === 3
            ? timingValid
            : true;

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
      recipientAddress: form.recipientAddress || null,
    });
  };

  const toggleWallet = (id: string) => {
    setForm((f) => {
      const selected = f.walletIds.includes(id);
      if (selected) return { ...f, walletIds: f.walletIds.filter((w) => w !== id) };
      if (f.walletIds.length >= walletCap) return f;
      return { ...f, walletIds: [...f.walletIds, id] };
    });
  };

  return (
    <>
      <PageHeader title="New task" description="Five steps from collection to armed transaction" />

      {/* Step rail */}
      <ol className="mb-6 flex flex-wrap items-center gap-2 text-xs">
        {STEPS.map((label, i) => (
          <li key={label} className="flex items-center gap-2">
            <span
              className={cn(
                'flex size-6 items-center justify-center rounded-full border text-[11px] font-medium',
                i < step && 'border-accent/40 bg-accent-subtle text-accent',
                i === step && 'border-accent bg-accent text-white',
                i > step && 'border-border bg-surface text-text-muted',
              )}
            >
              {i + 1}
            </span>
            <span className={i === step ? 'text-text-primary' : 'text-text-muted'}>{label}</span>
            {i < STEPS.length - 1 && <span className="mx-1 h-px w-6 bg-border" aria-hidden />}
          </li>
        ))}
      </ol>

      <Card>
        <CardContent className="pt-5">
          {step === 0 && (
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Task name">
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Bored Apes public mint"
                />
              </Field>
              <Field label="Chain">
                <Select
                  value={form.chainKey}
                  onChange={(e) => setForm({ ...form, chainKey: e.target.value })}
                >
                  <option value="">Select chain</option>
                  {chains.data?.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.name} ({c.chainId})
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="md:col-span-2">
                <Field
                  label="Collection"
                  hint="Contract address (public mints, no OpenSea account needed) or OpenSea slug / URL (allowlist and FCFS)"
                >
                  <Input
                    value={form.collection}
                    onChange={(e) => setForm({ ...form, collection: e.target.value })}
                    placeholder="0x... or bored-ape-yacht-club"
                    className="mono"
                  />
                </Field>
              </div>
              <Field label="Mint mode" hint="Auto resolves the stage from the chain">
                <Select
                  value={form.mintMode}
                  onChange={(e) => setForm({ ...form, mintMode: e.target.value as MintMode })}
                >
                  <option value={MintMode.Auto}>Auto detect</option>
                  <option value={MintMode.Public}>Public</option>
                  <option value={MintMode.Allowlist}>Allowlist</option>
                  <option value={MintMode.Fcfs}>FCFS</option>
                </Select>
              </Field>
            </div>
          )}

          {step === 1 && (
            <div className="flex flex-col gap-4">
              <div className="grid gap-4 md:grid-cols-3">
                <Field label="Wallet mode">
                  <Select
                    value={form.walletMode}
                    onChange={(e) => {
                      const mode = e.target.value as WalletMode;
                      const cap = MAX_WALLETS_PER_TASK[mode] ?? 1;
                      setForm({ ...form, walletMode: mode, walletIds: form.walletIds.slice(0, cap) });
                    }}
                  >
                    <option value={WalletMode.Single}>Single (1)</option>
                    <option value={WalletMode.SelfFunded}>Self-funded (max 10)</option>
                  </Select>
                </Field>
                <Field label="Quantity per wallet">
                  <Input
                    type="number"
                    min={1}
                    max={50}
                    value={form.quantity}
                    onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })}
                  />
                </Field>
                <Field
                  label="Recipient (optional)"
                  hint="Forward minted NFTs here after the mint"
                >
                  <Input
                    value={form.recipientAddress}
                    onChange={(e) => setForm({ ...form, recipientAddress: e.target.value })}
                    placeholder="0x..."
                    className="mono"
                  />
                </Field>
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="label">Select wallets</span>
                  <span className="text-xs text-text-muted">
                    {form.walletIds.length}/{walletCap} selected
                  </span>
                </div>
                <div className="grid max-h-64 gap-2 overflow-y-auto pr-1 md:grid-cols-2">
                  {wallets.data?.map((wallet) => {
                    const selected = form.walletIds.includes(wallet.id);
                    return (
                      <button
                        key={wallet.id}
                        type="button"
                        onClick={() => toggleWallet(wallet.id)}
                        className={cn(
                          'flex items-center justify-between rounded-[8px] border px-3 py-2.5 text-left transition-colors',
                          selected
                            ? 'border-accent/50 bg-accent-subtle'
                            : 'border-border bg-surface-2 hover:border-text-muted',
                        )}
                      >
                        <span className="mono text-text-secondary">{wallet.address}</span>
                        {wallet.label && <span className="text-xs text-text-muted">{wallet.label}</span>}
                      </button>
                    );
                  })}
                  {(wallets.data?.length ?? 0) === 0 && (
                    <p className="text-sm text-text-secondary">
                      No wallets yet. Add one on the Wallets page first.
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="grid gap-4 md:grid-cols-3">
              <Field label="Max fee ceiling (gwei)" hint="Reject if base fee is above this">
                <Input
                  type="number"
                  step="0.001"
                  min="0.001"
                  value={form.maxFeeGwei}
                  onChange={(e) => setForm({ ...form, maxFeeGwei: Number(e.target.value) })}
                />
              </Field>
              <Field label="Priority tip (gwei)" hint="Must stay below the ceiling">
                <Input
                  type="number"
                  step="0.001"
                  min="0"
                  value={form.maxPriorityGwei}
                  onChange={(e) => setForm({ ...form, maxPriorityGwei: Number(e.target.value) })}
                />
              </Field>
              <Field label="Gas limit per tx">
                <Input
                  type="number"
                  min="21000"
                  max="2000000"
                  value={form.gasLimit}
                  onChange={(e) => setForm({ ...form, gasLimit: Number(e.target.value) })}
                />
              </Field>
              {!gasValid && (
                <p className="text-sm text-danger md:col-span-3">
                  The priority tip must be below the fee ceiling.
                </p>
              )}
              <div className="md:col-span-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="label">RPC endpoints (optional)</span>
                  <a href="/rpc" className="text-xs text-accent hover:underline">
                    Manage endpoints
                  </a>
                </div>
                <div className="grid max-h-40 gap-2 overflow-y-auto pr-1 md:grid-cols-2">
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
                  className="input-base mt-2 min-h-16"
                  value={customRpcs}
                  onChange={(e) => setCustomRpcs(e.target.value)}
                  placeholder={'Extra RPC URLs, one per line (optional)'}
                />
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Timing">
                <Select
                  value={form.timingMode}
                  onChange={(e) => setForm({ ...form, timingMode: e.target.value as TimingMode })}
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
                    onChange={(e) => setForm({ ...form, customFireTime: e.target.value })}
                  />
                </Field>
              )}
            </div>
          )}

          {step === 4 && (
            <dl className="grid gap-x-8 gap-y-3 text-sm md:grid-cols-2">
              <Row label="Name" value={form.name} />
              <Row label="Collection" value={form.collection} mono />
              <Row label="Chain" value={form.chainKey} />
              <Row label="Mode" value={`${form.mintMode} / ${form.walletMode}`} />
              <Row label="Wallets" value={`${form.walletIds.length} x ${form.quantity}`} />
              <Row label="Gas" value={`${form.maxFeeGwei} / ${form.maxPriorityGwei} gwei, limit ${form.gasLimit}`} />
              <Row label="Timing" value={form.timingMode} />
              {form.recipientAddress && <Row label="Recipient" value={form.recipientAddress} mono />}
              <Row
                label="Est. upfront per wallet"
                value={`≈ ${(form.gasLimit * form.maxFeeGwei / 1e9).toFixed(5)} ETH + mint price`}
                mono
              />
            </dl>
          )}

          <div className="mt-8 flex items-center justify-between">
            <Button
              variant="ghost"
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              disabled={step === 0}
            >
              <ArrowLeft className="size-4" aria-hidden />
              Back
            </Button>
            {step < STEPS.length - 1 ? (
              <Button onClick={() => setStep((s) => s + 1)} disabled={!stepValid}>
                Continue
                <ArrowRight className="size-4" aria-hidden />
              </Button>
            ) : (
              <Button onClick={submit} loading={create.isPending}>
                <Rocket className="size-4" aria-hidden />
                Schedule task
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border pb-2">
      <dt className="text-text-secondary">{label}</dt>
      <dd className={cn('text-right', mono && 'mono text-text-secondary')}>{value}</dd>
    </div>
  );
}
