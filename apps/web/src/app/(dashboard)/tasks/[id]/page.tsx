'use client';

import { use, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { WS_EVENTS, type ChainView, type TaskLogEvent, type TaskView } from '@mintbot/shared';
import { api } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import { StatusBadge, ResultStatusBadge } from '@/components/status-badge';
import { AddressDisplay, TxLink } from '@/components/address-display';
import { CountdownTimer } from '@/components/countdown-timer';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
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
  }>;
}

interface LogEntry {
  id: string;
  level: string;
  message: string;
  walletIndex: number | null;
  timestamp: string;
}

const levelColor: Record<string, string> = {
  info: 'text-text-secondary',
  success: 'text-success',
  warn: 'text-warning',
  error: 'text-danger',
};

export default function TaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const queryClient = useQueryClient();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  const detail = useQuery({
    queryKey: ['task', id],
    queryFn: () => api.get<TaskDetail>(`/tasks/${id}`),
    refetchInterval: 5_000,
  });

  const initialLogs = useQuery({
    queryKey: ['task-logs', id],
    queryFn: () => api.get<{ data: LogEntry[] }>(`/tasks/${id}/logs?page=1&limit=200`),
  });

  const chains = useQuery({
    queryKey: ['chains'],
    queryFn: () => api.get<ChainView[]>('/chains'),
  });

  useEffect(() => {
    if (initialLogs.data?.data) setLogs(initialLogs.data.data);
  }, [initialLogs.data]);

  // Live stream
  useEffect(() => {
    const socket = getSocket();
    const join = () => socket.emit(WS_EVENTS.JOIN, { taskId: id });
    socket.on('connect', join);
    join();

    const onLog = (event: TaskLogEvent) => {
      if (event.taskId !== id) return;
      setLogs((prev) => [...prev.slice(-400), { id: crypto.randomUUID(), ...event }]);
    };
    socket.on(WS_EVENTS.LOG, onLog);
    socket.on(WS_EVENTS.STATUS, () => void queryClient.invalidateQueries({ queryKey: ['task', id] }));
    socket.on(WS_EVENTS.WALLET, () => void queryClient.invalidateQueries({ queryKey: ['task', id] }));
    socket.on(WS_EVENTS.COMPLETE, () => void queryClient.invalidateQueries({ queryKey: ['task', id] }));

    return () => {
      socket.off('connect', join);
      socket.off(WS_EVENTS.LOG, onLog);
      socket.emit(WS_EVENTS.LEAVE, { taskId: id });
    };
  }, [id, queryClient]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [logs]);

  const task = detail.data?.task;
  const explorer = chains.data?.find((c) => c.key === task?.chainKey)?.explorer;

  if (!task) {
    return <p className="text-sm text-text-secondary">Loading task...</p>;
  }

  return (
    <>
      <div className="flex items-center gap-3 pb-6">
        <Link href="/tasks" className="rounded p-1.5 text-text-secondary hover:bg-surface-2 hover:text-text-primary">
          <ArrowLeft className="size-4" aria-hidden />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="truncate text-xl font-semibold tracking-tight">{task.name}</h1>
            <StatusBadge status={task.status} />
          </div>
          <p className="mono mt-1 text-text-muted">{task.collection}</p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        {/* Config panel */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Configuration</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <Item label="Chain" value={task.chainKey} />
              <Item label="Mode" value={`${task.mintMode} / ${task.walletMode}`} />
              <Item label="Wallets" value={`${task.walletIds.length} x ${task.quantity}`} />
              <Item
                label="Gas"
                value={`${task.maxFeeGwei} / ${task.maxPriorityGwei} gwei`}
              />
              <Item label="Gas limit" value={String(task.gasLimit)} mono />
              <Item label="Timing" value={task.timingMode} />
              {task.resolvedFireAt && (
                <div className="col-span-2 flex items-center justify-between gap-2">
                  <dt className="text-text-secondary">Fires in</dt>
                  <dd><CountdownTimer target={task.resolvedFireAt} /></dd>
                </div>
              )}
              {task.customFireTime && (
                <Item
                  label="Custom fire"
                  value={new Date(task.customFireTime).toLocaleString()}
                />
              )}
              {task.recipientAddress && (
                <div className="col-span-2 flex items-center justify-between gap-2">
                  <dt className="text-text-secondary">Recipient</dt>
                  <dd><AddressDisplay address={task.recipientAddress} explorer={explorer} /></dd>
                </div>
              )}
            </dl>
          </CardContent>
        </Card>

        {/* Live log stream */}
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Execution log</CardTitle>
            <span className="flex items-center gap-1.5 text-[11px] text-text-muted">
              <span className="inline-block size-1.5 animate-pulse rounded-full bg-success" aria-hidden />
              live
            </span>
          </CardHeader>
          <CardContent className="px-0 pb-3">
            <div
              ref={logRef}
              className="mono h-72 overflow-y-auto px-5"
              role="log"
              aria-label="Task execution log"
            >
              {logs.length === 0 && <p className="text-text-muted">Waiting for execution logs...</p>}
              {logs.map((log) => (
                <div key={log.id} className="flex gap-3 py-0.5">
                  <span className="shrink-0 text-text-muted">
                    {new Date(log.timestamp).toLocaleTimeString()}
                  </span>
                  <span className={cn('break-all', levelColor[log.level] ?? 'text-text-secondary')}>
                    {log.message}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Wallet results */}
      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Wallets</CardTitle>
        </CardHeader>
        <Table>
          <THead>
            <TR>
              <TH>#</TH>
              <TH>Address</TH>
              <TH>Status</TH>
              <TH>Tx</TH>
              <TH>Block</TH>
              <TH>Gas</TH>
            </TR>
          </THead>
          <TBody>
            {(detail.data?.wallets ?? []).map((wallet) => {
              const result = detail.data?.results.find(
                (r) => r.walletAddress.toLowerCase() === wallet.address.toLowerCase(),
              );
              return (
                <TR key={wallet.id}>
                  <TD className="mono text-text-muted">
                    W{detail.data?.wallets.findIndex((w) => w.id === wallet.id) ?? 0}
                  </TD>
                  <TD><AddressDisplay address={wallet.address} explorer={explorer} /></TD>
                  <TD>{result ? <ResultStatusBadge status={result.status} /> : <span className="text-xs text-text-muted">idle</span>}</TD>
                  <TD>{result?.txHash ? <TxLink txHash={result.txHash} explorer={explorer} /> : <span className="text-text-muted">-</span>}</TD>
                  <TD className="mono text-text-secondary">{result?.blockNumber ?? '-'}</TD>
                  <TD className="mono text-text-secondary">{result?.gasUsed?.toLocaleString() ?? '-'}</TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      </Card>
    </>
  );
}

function Item({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd className={cn(mono && 'mono text-text-secondary')}>{value}</dd>
    </div>
  );
}
