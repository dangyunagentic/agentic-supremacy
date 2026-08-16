'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { Ban, Plus } from 'lucide-react';
import type { Paginated, TaskView } from '@mintbot/shared';
import { isTaskCancellable } from '@mintbot/shared';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { TableSkeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/stat-card';
import { NewTaskDialog } from '@/components/tasks/new-task-dialog';

export default function TasksPage() {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);

  const tasks = useQuery({
    queryKey: ['tasks'],
    queryFn: () => api.get<Paginated<TaskView>>('/tasks?page=1&limit=50'),
    refetchInterval: 10_000,
  });

  const stopTask = useMutation({
    mutationFn: (id: string) => api.post(`/tasks/${id}/stop`),
    onSuccess: () => {
      toast.success('Task cancelled');
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <>
      <PageHeader
        title="Tasks"
        description="Every mint task with live status"
        actions={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" aria-hidden />
            New task
          </Button>
        }
      />

      <Card>
        {tasks.isLoading ? (
          <TableSkeleton rows={6} />
        ) : (tasks.data?.data.length ?? 0) === 0 ? (
          <EmptyState
            title="No tasks yet"
            description="Create a mint task to schedule pre-signed transactions against a SeaDrop stage."
            action={
              <Button size="sm" variant="secondary" onClick={() => setCreateOpen(true)}>
                Create a task
              </Button>
            }
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Task</TH>
                <TH>Chain</TH>
                <TH>Mode</TH>
                <TH>Status</TH>
                <TH>Wallets</TH>
                <TH>Created</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {tasks.data?.data.map((task) => (
                <TR key={task.id}>
                  <TD>
                    <Link href={`/tasks/${task.id}`} className="font-medium hover:text-accent">
                      {task.name}
                    </Link>
                    <p className="mono text-text-muted">{task.collection}</p>
                  </TD>
                  <TD className="text-text-secondary">{task.chainKey}</TD>
                  <TD className="text-text-secondary">
                    {task.mintMode} / {task.walletMode}
                  </TD>
                  <TD>
                    <StatusBadge status={task.status} />
                  </TD>
                  <TD className="mono text-text-secondary">{task.walletIds.length} x {task.quantity}</TD>
                  <TD className="text-text-secondary">
                    {format(new Date(task.createdAt), 'd MMM HH:mm')}
                  </TD>
                  <TD>
                    {isTaskCancellable(task.status) && (
                      <Button
                        size="sm"
                        variant="danger"
                        loading={stopTask.isPending && stopTask.variables === task.id}
                        onClick={() => stopTask.mutate(task.id)}
                      >
                        <Ban className="size-3.5" aria-hidden />
                        Stop
                      </Button>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      <NewTaskDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </>
  );
}
