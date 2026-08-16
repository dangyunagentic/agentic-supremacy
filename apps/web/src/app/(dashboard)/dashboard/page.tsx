'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Layers, Plus, Timer, TrendingUp, XCircle } from 'lucide-react';
import { api } from '@/lib/api';
import type { AdminStatsView, Paginated, TaskView } from '@mintbot/shared';
import { PageHeader } from '@/components/layout/page-header';
import { StatCard, EmptyState } from '@/components/stat-card';
import { StatusBadge } from '@/components/status-badge';
import { CountdownTimer } from '@/components/countdown-timer';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { TableSkeleton } from '@/components/ui/skeleton';
import { useAuthStore } from '@/lib/auth-store';
import { NewTaskDialog } from '@/components/tasks/new-task-dialog';

interface DashboardStats {
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  successRate: number;
}

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'admin';
  const [createOpen, setCreateOpen] = useState(false);

  const tasks = useQuery({
    queryKey: ['tasks'],
    queryFn: () => api.get<Paginated<TaskView>>('/tasks?page=1&limit=100'),
    refetchInterval: 15_000,
  });

  const stats = useQuery({
    queryKey: ['stats'],
    queryFn: () => api.get<AdminStatsView>('/admin/stats'),
    enabled: isAdmin,
    refetchInterval: 30_000,
  });

  const all = tasks.data?.data ?? [];
  const active = all.filter((t) =>
    ['scheduled', 'pre_flight', 'calldata', 'pre_sign', 'dispatching', 'awaiting_receipt'].includes(t.status),
  );
  const completed = all.filter((t) => t.status === 'completed').length;
  const failed = all.filter((t) => t.status === 'failed').length;

  const local: DashboardStats = {
    totalTasks: all.length,
    completedTasks: completed,
    failedTasks: failed,
    successRate:
      isAdmin && stats.data
        ? stats.data.successRate
        : completed + failed > 0
          ? completed / (completed + failed)
          : 0,
  };

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={isAdmin ? 'System-wide mint activity' : 'Your mint activity at a glance'}
        actions={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" aria-hidden />
            New task
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="Active tasks" value={String(active.length)} icon={<Timer className="size-4" />} tone="accent" />
        <StatCard label="Completed" value={String(local.completedTasks)} icon={<CheckCircle2 className="size-4" />} tone="success" />
        <StatCard label="Failed" value={String(local.failedTasks)} icon={<XCircle className="size-4" />} tone="danger" />
        <StatCard
          label="Success rate"
          value={`${(local.successRate * 100).toFixed(0)}%`}
          icon={<TrendingUp className="size-4" />}
          tone="warning"
          hint={isAdmin && stats.data ? `${stats.data.totalMinted} NFTs minted system-wide` : undefined}
        />
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Active tasks</CardTitle>
          <Link href="/tasks" className="text-xs text-accent hover:underline">
            View all
          </Link>
        </CardHeader>
        {tasks.isLoading ? (
          <TableSkeleton />
        ) : active.length === 0 ? (
          <EmptyState
            title="Nothing running"
            description="No scheduled or executing tasks. Create one and the engine handles the rest."
            action={
              <Button size="sm" variant="secondary" onClick={() => setCreateOpen(true)}>
                <Layers className="size-4" aria-hidden />
                Create your first task
              </Button>
            }
          />
        ) : (
          <CardContent className="px-0 pb-0">
            <Table>
              <THead>
                <TR>
                  <TH>Task</TH>
                  <TH>Chain</TH>
                  <TH>Status</TH>
                  <TH>Fire time</TH>
                  <TH>Wallets</TH>
                </TR>
              </THead>
              <TBody>
                {active.map((task) => (
                  <TR key={task.id} className="cursor-pointer">
                    <TD>
                      <Link href={`/tasks/${task.id}`} className="font-medium hover:text-accent">
                        {task.name}
                      </Link>
                    </TD>
                    <TD className="text-text-secondary">{task.chainKey}</TD>
                    <TD>
                      <StatusBadge status={task.status} />
                    </TD>
                    <TD>
                      <CountdownTimer target={task.resolvedFireAt ?? task.createdAt} />
                    </TD>
                    <TD className="mono text-text-secondary">{task.walletIds.length} x {task.quantity}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        )}
      </Card>

      <NewTaskDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </>
  );
}
