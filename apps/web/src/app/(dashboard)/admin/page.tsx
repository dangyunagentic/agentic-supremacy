'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { Plus, ShieldBan, ShieldCheck, Trash2 } from 'lucide-react';
import type { Paginated, UserView } from '@mintbot/shared';
import { Role, UserStatus } from '@mintbot/shared';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/input';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { TableSkeleton } from '@/components/ui/skeleton';

export default function AdminUsersPage() {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<{ email: string; username: string; password: string; role: Role }>({
    email: '',
    username: '',
    password: '',
    role: Role.User,
  });

  const users = useQuery({
    queryKey: ['admin-users'],
    queryFn: () => api.get<Paginated<UserView>>('/admin/users?page=1&limit=50'),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin-users'] });

  const createUser = useMutation({
    mutationFn: (body: typeof form) => api.post('/admin/users', body),
    onSuccess: () => {
      toast.success('User created');
      setCreateOpen(false);
      setForm({ email: '', username: '', password: '', role: Role.User });
      void invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateUser = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, string> }) =>
      api.patch(`/admin/users/${id}`, body),
    onSuccess: () => {
      toast.success('User updated');
      void invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteUser = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/users/${id}`),
    onSuccess: () => {
      toast.success('User deleted');
      void invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <>
      <PageHeader
        title="Users"
        description="Manage accounts, roles and suspension"
        actions={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" aria-hidden />
            Create user
          </Button>
        }
      />

      <Card>
        {users.isLoading ? (
          <TableSkeleton rows={6} />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>User</TH>
                <TH>Role</TH>
                <TH>Status</TH>
                <TH>Telegram</TH>
                <TH>Joined</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {users.data?.data.map((user) => (
                <TR key={user.id}>
                  <TD>
                    <p className="font-medium">{user.username}</p>
                    <p className="text-xs text-text-muted">{user.email}</p>
                  </TD>
                  <TD>
                    <Badge tone={user.role === Role.Admin ? 'accent' : 'neutral'}>{user.role}</Badge>
                  </TD>
                  <TD>
                    <Badge tone={user.status === UserStatus.Active ? 'success' : 'danger'}>
                      {user.status}
                    </Badge>
                  </TD>
                  <TD className="mono text-xs text-text-secondary">
                    {user.telegramId ? `${user.telegramId.slice(0, 8)}...` : '-'}
                  </TD>
                  <TD className="text-text-secondary">
                    {format(new Date(user.createdAt), 'd MMM yyyy')}
                  </TD>
                  <TD>
                    <div className="flex items-center justify-end gap-1">
                      {user.status === UserStatus.Active ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label="Suspend user"
                          onClick={() => updateUser.mutate({ id: user.id, body: { status: UserStatus.Suspended } })}
                        >
                          <ShieldBan className="size-3.5 text-warning" aria-hidden />
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label="Reactivate user"
                          onClick={() => updateUser.mutate({ id: user.id, body: { status: UserStatus.Active } })}
                        >
                          <ShieldCheck className="size-3.5 text-success" aria-hidden />
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label="Delete user"
                        onClick={() => {
                          if (confirm(`Delete user ${user.username}? This removes their wallets and tasks.`)) {
                            deleteUser.mutate(user.id);
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

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} title="Create user">
        <div className="flex flex-col gap-4">
          <Field label="Email">
            <Input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </Field>
          <Field label="Username">
            <Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          </Field>
          <Field label="Password" hint="At least 10 characters">
            <Input
              type="password"
              minLength={10}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </Field>
          <Field label="Role">
            <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
              <option value={Role.User}>User</option>
              <option value={Role.Admin}>Admin</option>
            </Select>
          </Field>
          <Button onClick={() => createUser.mutate(form)} loading={createUser.isPending}>
            Create user
          </Button>
        </div>
      </Dialog>
    </>
  );
}
