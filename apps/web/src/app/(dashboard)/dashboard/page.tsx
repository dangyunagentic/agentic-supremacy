'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  Layers,
  Plus,
  Timer,
  TrendingUp,
  XCircle,
  ExternalLink,
  Play,
  Square,
  Trash2,
  Clock,
  Sparkles,
  RefreshCw,
  Copy,
  Check,
} from 'lucide-react';
import { api } from '@/lib/api';
import type { AdminStatsView, ChainView, Paginated, TaskView } from '@mintbot/shared';
import { PageHeader } from '@/components/layout/page-header';
import { StatCard, EmptyState } from '@/components/stat-card';
import { StatusBadge, ResultStatusBadge } from '@/components/status-badge';
import { CountdownTimer } from '@/components/countdown-timer';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { TableSkeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { AddressDisplay, TxLink } from '@/components/address-display';
import { useAuthStore } from '@/lib/auth-store';
import { NewTaskDialog } from '@/components/tasks/new-task-dialog';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface TaskDetail {
  task: TaskView;
  wallets: Array<{ id: string; address: string; label: string | null; chainId: number }>;
  results: Array<{
    id: string;
    walletAddress: string;
    walletIndex: number;
    txHash: string | null;
    blockNumber: number | null;
    status: string;
    gasUsed: number | null;
    errorMessage: string | null;
    createdAt?: string;
  }>;
}

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'admin';
  const queryClient = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedWallets, setSelectedWallets] = useState<string[]>([]);
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);

  const tasks = useQuery({
    queryKey: ['tasks'],
    queryFn: () => api.get<Paginated<TaskView>>('/tasks?page=1&limit=100'),
    refetchInterval: 5_000,
  });

  const chains = useQuery({
    queryKey: ['chains'],
    queryFn: () => api.get<ChainView[]>('/chains'),
  });

  const stats = useQuery({
    queryKey: ['stats'],
    queryFn: () => api.get<AdminStatsView>('/admin/stats'),
    enabled: isAdmin,
    refetchInterval: 20_000,
  });

  const allTasks = tasks.data?.data ?? [];
  const activeTasks = allTasks.filter((t) =>
    ['scheduled', 'pre_flight', 'calldata', 'pre_sign', 'dispatching', 'awaiting_receipt'].includes(t.status),
  );
  const completedCount = allTasks.filter((t) => t.status === 'completed').length;
  const failedCount = allTasks.filter((t) => t.status === 'failed').length;

  const activeSelectedId = selectedTaskId && allTasks.some((t) => t.id === selectedTaskId)
    ? selectedTaskId
    : allTasks[0]?.id ?? null;

  const currentTaskDetail = useQuery({
    queryKey: ['task-detail', activeSelectedId],
    queryFn: () => (activeSelectedId ? api.get<TaskDetail>(`/tasks/${activeSelectedId}`) : null),
    enabled: Boolean(activeSelectedId),
    refetchInterval: 3_000,
  });

  const stopTask = useMutation({
    mutationFn: (id: string) => api.post(`/tasks/${id}/stop`, {}),
    onSuccess: () => {
      toast.success('Task stopped');
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
      void queryClient.invalidateQueries({ queryKey: ['task-detail', activeSelectedId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteTask = useMutation({
    mutationFn: (id: string) => api.delete(`/tasks/${id}`),
    onSuccess: () => {
      toast.success('Task deleted');
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
      setSelectedTaskId(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const runNow = useMutation({
    mutationFn: (id: string) => api.post(`/tasks/${id}/run-now`, {}),
    onSuccess: () => {
      toast.success('Task execution triggered now');
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
      void queryClient.invalidateQueries({ queryKey: ['task-detail', activeSelectedId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const currentTask = currentTaskDetail.data?.task ?? allTasks.find((t) => t.id === activeSelectedId);
  const currentExplorer = chains.data?.find((c) => c.key === currentTask?.chainKey)?.explorer;
  const wallets = currentTaskDetail.data?.wallets ?? [];
  const results = currentTaskDetail.data?.results ?? [];

  const successResultsCount = results.filter((r) => r.status === 'success').length;
  const failedResultsCount = results.filter((r) => r.status === 'failed').length;

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedAddress(text);
    setTimeout(() => setCopiedAddress(null), 2000);
  };

  const toggleSelectAll = () => {
    if (selectedWallets.length === wallets.length) {
      setSelectedWallets([]);
    } else {
      setSelectedWallets(wallets.map((w) => w.id));
    }
  };

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Monitor multi-wallet mint operations, task execution status, and success rates"
        actions={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" aria-hidden />
            New task
          </Button>
        }
      />

      {/* Top Stats Cards */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard
          label="Active tasks"
          value={String(activeTasks.length)}
          icon={<Timer className="size-4" />}
          tone="accent"
        />
        <StatCard
          label="Completed"
          value={String(completedCount)}
          icon={<CheckCircle2 className="size-4" />}
          tone="success"
        />
        <StatCard
          label="Failed"
          value={String(failedCount)}
          icon={<XCircle className="size-4" />}
          tone="danger"
        />
        <StatCard
          label="Total Tasks"
          value={String(allTasks.length)}
          icon={<Layers className="size-4" />}
          tone="neutral"
          hint={isAdmin && stats.data ? `${stats.data.totalMinted} NFTs minted system-wide` : undefined}
        />
      </div>

      {/* Main Task Matrix Card */}
      <Card className="mt-6 border-border/80 bg-surface shadow-lg">
        <CardHeader className="pb-3 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
            {/* Task Tabs Bar (Horizontal Tabs like in the reference) */}
            <div className="flex flex-1 items-center gap-2 overflow-x-auto no-scrollbar py-1">
              {allTasks.map((t) => {
                const isSelected = t.id === activeSelectedId;
                const isRunning = [
                  'scheduled',
                  'pre_flight',
                  'calldata',
                  'pre_sign',
                  'dispatching',
                  'awaiting_receipt',
                ].includes(t.status);

                return (
                  <button
                    key={t.id}
                    onClick={() => setSelectedTaskId(t.id)}
                    className={cn(
                      'group flex shrink-0 items-center gap-2.5 rounded-[8px] border px-3.5 py-2 text-xs font-semibold transition-all',
                      isSelected
                        ? 'border-accent bg-accent/15 text-text-primary shadow-sm ring-1 ring-accent/30'
                        : 'border-border/60 bg-surface-2/60 text-text-secondary hover:border-text-muted hover:bg-surface-2 hover:text-text-primary',
                    )}
                  >
                    {isRunning && (
                      <span className="size-2 rounded-full bg-accent animate-pulse" />
                    )}
                    <span className="truncate max-w-[150px]">{t.name}</span>
                    <span className="mono text-[11px] text-text-muted font-normal">
                      {t.walletIds.length} <span className="text-text-primary font-medium">x{t.quantity}</span>
                    </span>
                    <Badge
                      tone={
                        t.status === 'completed'
                          ? 'success'
                          : t.status === 'failed'
                            ? 'danger'
                            : isRunning
                              ? 'accent'
                              : 'neutral'
                      }
                      className="text-[9px] px-1.5 py-0 uppercase"
                    >
                      {t.status === 'awaiting_receipt' ? 'receipt' : t.status}
                    </Badge>
                  </button>
                );
              })}

              <button
                onClick={() => setCreateOpen(true)}
                className="flex shrink-0 items-center gap-1.5 rounded-[8px] border border-dashed border-border px-3 py-2 text-xs font-medium text-text-muted hover:border-accent hover:text-accent transition-colors"
              >
                <Plus className="size-3.5" />
                Add task
              </button>
            </div>

            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  void queryClient.invalidateQueries({ queryKey: ['tasks'] });
                  void queryClient.invalidateQueries({ queryKey: ['task-detail', activeSelectedId] });
                }}
              >
                <RefreshCw className="size-3.5" />
                Refresh
              </Button>
              <Link href="/tasks">
                <Button size="sm" variant="secondary">
                  Manage all
                </Button>
              </Link>
            </div>
          </div>
        </CardHeader>

        {tasks.isLoading ? (
          <TableSkeleton rows={6} />
        ) : allTasks.length === 0 ? (
          <EmptyState
            title="No tasks created yet"
            description="Create your first mint task to monitor wallet execution in realtime."
            action={
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="size-4" aria-hidden />
                Create task
              </Button>
            }
          />
        ) : !currentTask ? (
          <p className="p-6 text-sm text-text-secondary">Select a task above to inspect wallet execution.</p>
        ) : (
          <CardContent className="pt-2">
            {/* Task Info & Controls Bar */}
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[8px] border border-border bg-surface-2/70 p-3">
              <div className="flex flex-wrap items-center gap-4 text-xs">
                <div>
                  <span className="text-text-muted">Collection: </span>
                  <span className="mono font-medium text-text-primary">{currentTask.collection}</span>
                </div>
                <div>
                  <span className="text-text-muted">Chain: </span>
                  <Badge tone="neutral" className="uppercase text-[10px]">{currentTask.chainKey}</Badge>
                </div>
                <div>
                  <span className="text-text-muted">Phase: </span>
                  <span className="text-text-primary uppercase font-medium">{currentTask.mintMode}</span>
                </div>
                <div>
                  <span className="text-text-muted">Total: </span>
                  <span className="mono text-text-primary font-medium">{wallets.length || currentTask.walletIds.length} Wallets</span>
                </div>
                {results.length > 0 && (
                  <div className="flex items-center gap-2">
                    <Badge tone="success" className="text-[10px] font-semibold">{successResultsCount} Success</Badge>
                    {failedResultsCount > 0 && (
                      <Badge tone="danger" className="text-[10px] font-semibold">{failedResultsCount} Failed</Badge>
                    )}
                  </div>
                )}
                {currentTask.resolvedFireAt && (
                  <div className="flex items-center gap-1.5 text-accent">
                    <Clock className="size-3" />
                    <CountdownTimer target={currentTask.resolvedFireAt} />
                  </div>
                )}
              </div>

              {/* Task Controls Action Buttons */}
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-8 text-xs font-medium"
                  onClick={() => runNow.mutate(currentTask.id)}
                  loading={runNow.isPending}
                  disabled={currentTask.status === 'completed' || currentTask.status === 'dispatching'}
                >
                  <Play className="size-3.5 text-success mr-1" />
                  Run Now
                </Button>

                <Button
                  size="sm"
                  variant="secondary"
                  className="h-8 text-xs font-medium"
                  onClick={() => stopTask.mutate(currentTask.id)}
                  loading={stopTask.isPending}
                  disabled={!['scheduled', 'pre_flight', 'calldata', 'pre_sign'].includes(currentTask.status)}
                >
                  <Square className="size-3.5 text-warning mr-1" />
                  Stop
                </Button>

                <Link href={`/tasks/${currentTask.id}`}>
                  <Button size="sm" variant="secondary" className="h-8 text-xs font-medium">
                    <ExternalLink className="size-3.5 mr-1" />
                    Logs
                  </Button>
                </Link>

                <Button
                  size="sm"
                  variant="danger"
                  className="h-8 text-xs px-2.5"
                  onClick={() => {
                    if (confirm(`Delete task "${currentTask.name}"?`)) {
                      deleteTask.mutate(currentTask.id);
                    }
                  }}
                  loading={deleteTask.isPending}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </div>

            {/* Wallets & Execution Status Table (Matrix View matching reference) */}
            <div className="overflow-x-auto rounded-[8px] border border-border bg-surface">
              <Table>
                <THead>
                  <TR className="bg-surface-2/50 text-[11px] uppercase tracking-wider text-text-muted">
                    <TH className="w-10">
                      <input
                        type="checkbox"
                        checked={wallets.length > 0 && selectedWallets.length === wallets.length}
                        onChange={toggleSelectAll}
                        className="rounded border-border"
                      />
                    </TH>
                    <TH className="w-44">Task / Wallet</TH>
                    <TH className="w-48">Address</TH>
                    <TH className="w-28">Status</TH>
                    <TH>Response / Details</TH>
                    <TH className="w-40">Transaction Hash</TH>
                    <TH className="w-28 text-right">Block / Gas</TH>
                  </TR>
                </THead>
                <TBody>
                  {wallets.length === 0 ? (
                    <TR>
                      <TD colSpan={7} className="py-8 text-center text-sm text-text-secondary">
                        Loading wallets for this task...
                      </TD>
                    </TR>
                  ) : (
                    wallets.map((wallet, idx) => {
                      const result = results.find(
                        (r) => r.walletAddress.toLowerCase() === wallet.address.toLowerCase(),
                      );

                      const isSuccess = result?.status === 'success';
                      const isFailed = result?.status === 'failed';
                      const isDispatched = result?.status === 'dispatched';
                      const isSelected = selectedWallets.includes(wallet.id);

                      return (
                        <TR
                          key={wallet.id}
                          className={cn(
                            'transition-colors border-b border-border/50',
                            isSuccess && 'bg-success/5 hover:bg-success/10',
                            isFailed && 'bg-danger/5 hover:bg-danger/10',
                            isSelected && 'bg-accent/10',
                          )}
                        >
                          <TD>
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() =>
                                setSelectedWallets((prev) =>
                                  prev.includes(wallet.id)
                                    ? prev.filter((id) => id !== wallet.id)
                                    : [...prev, wallet.id],
                                )
                              }
                              className="rounded border-border"
                            />
                          </TD>

                          <TD>
                            <div className="flex flex-col">
                              <span className="font-semibold text-xs text-text-primary">
                                {currentTask.name} · {wallet.label || `wallet-${idx + 1}`}
                              </span>
                              <span className="text-[10px] text-text-muted mono">
                                index #{idx + 1}
                              </span>
                            </div>
                          </TD>

                          <TD>
                            <div className="flex items-center gap-1.5">
                              <span className="mono text-xs text-text-secondary">
                                {wallet.address.slice(0, 6)}...{wallet.address.slice(-4)}
                              </span>
                              <button
                                onClick={() => copyToClipboard(wallet.address)}
                                className="text-text-muted hover:text-text-primary p-0.5"
                                title="Copy address"
                              >
                                {copiedAddress === wallet.address ? (
                                  <Check className="size-3 text-success" />
                                ) : (
                                  <Copy className="size-3" />
                                )}
                              </button>
                            </div>
                          </TD>

                          <TD>
                            {result ? (
                              <ResultStatusBadge status={result.status} />
                            ) : (
                              <Badge tone="neutral" className="text-[10px] uppercase font-mono">
                                {currentTask.status === 'scheduled' ? 'QUEUED' : 'READY'}
                              </Badge>
                            )}
                          </TD>

                          <TD className="text-xs">
                            {isSuccess ? (
                              <span className="text-success flex items-center gap-1 font-medium">
                                <CheckCircle2 className="size-3.5 shrink-0" />
                                Success (Minted x{currentTask.quantity})
                              </span>
                            ) : isFailed ? (
                              <span className="text-danger flex items-center gap-1">
                                <XCircle className="size-3.5 shrink-0" />
                                <span className="truncate max-w-[320px]" title={result?.errorMessage || 'Reverted'}>
                                  {result?.errorMessage || 'Transaction reverted / failed'}
                                </span>
                              </span>
                            ) : isDispatched ? (
                              <span className="text-accent flex items-center gap-1">
                                <Timer className="size-3.5 animate-spin shrink-0" />
                                Dispatched (Mempool pending...)
                              </span>
                            ) : (
                              <span className="text-text-muted">Idle (Waiting for fire trigger)</span>
                            )}
                          </TD>

                          <TD>
                            {result?.txHash ? (
                              <TxLink txHash={result.txHash} explorer={currentExplorer} />
                            ) : (
                              <span className="text-text-muted text-xs mono">-</span>
                            )}
                          </TD>

                          <TD className="text-right mono text-xs text-text-secondary">
                            {result?.blockNumber ? (
                              <span>
                                #{result.blockNumber} {result.gasUsed ? `(${result.gasUsed.toLocaleString()})` : ''}
                              </span>
                            ) : (
                              '-'
                            )}
                          </TD>
                        </TR>
                      );
                    })
                  )}
                </TBody>
              </Table>
            </div>
          </CardContent>
        )}
      </Card>

      <NewTaskDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </>
  );
}
