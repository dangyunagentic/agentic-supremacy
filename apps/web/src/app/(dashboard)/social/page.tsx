'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Trash2, Play, PlugZap, ShieldCheck } from 'lucide-react';
import type { SocialAccountView, SocialRunView } from '@mintbot/shared';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, TextArea } from '@/components/ui/input';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { TableSkeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/stat-card';
import { format } from 'date-fns';

const PLATFORMS = [
  { value: 'x', label: 'X (Twitter)' },
  { value: 'gmail', label: 'Gmail' },
  { value: 'discord', label: 'Discord' },
];

const ACTIONS = [
  { value: 'x_follow', label: 'X — Follow' },
  { value: 'x_unfollow', label: 'X — Unfollow' },
  { value: 'x_reply', label: 'X — Reply' },
  { value: 'x_repost', label: 'X — Repost' },
  { value: 'form_submit', label: 'Form submit' },
  { value: 'wallet_submit', label: 'Wallet submit' },
  { value: 'captcha_solve', label: 'CAPTCHA solve' },
];

function actionHint(action: string): string {
  switch (action) {
    case 'x_follow':
    case 'x_unfollow':
      return '{ "userId": "..." }';
    case 'x_reply':
      return '{ "tweetId": "...", "text": "..." }';
    case 'x_repost':
      return '{ "tweetId": "..." }';
    case 'wallet_submit':
      return '{ "url": "...", "wallet": "0x...", "fieldName": "wallet" }';
    case 'form_submit':
      return '{ "url": "...", "fields": { "entry.123": "value" } }';
    case 'captcha_solve':
      return '{ "siteKey": "...", "pageUrl": "..." }';
    default:
      return '{}';
  }
}

export default function SocialPage() {
  const queryClient = useQueryClient();
  const [accountOpen, setAccountOpen] = useState(false);
  const [runOpen, setRunOpen] = useState(false);

  // account form
  const [platform, setPlatform] = useState('x');
  const [username, setUsername] = useState('');
  const [credentials, setCredentials] = useState('');
  const [proxy, setProxy] = useState('');

  // run form
  const [runAccountId, setRunAccountId] = useState('');
  const [runActionName, setRunActionName] = useState('x_follow');
  const [runInput, setRunInput] = useState('');
  const [runProxy, setRunProxy] = useState('');

  const accounts = useQuery({
    queryKey: ['social-accounts'],
    queryFn: () => api.get<SocialAccountView[]>('/social/accounts'),
  });

  const runs = useQuery({
    queryKey: ['social-runs'],
    queryFn: () => api.get<{ data: SocialRunView[] }>('/social/runs?page=1&limit=20'),
  });

  const createAccount = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post('/social/accounts', body),
    onSuccess: () => {
      toast.success('Account added');
      setAccountOpen(false);
      setPlatform('x');
      setUsername('');
      setCredentials('');
      setProxy('');
      void queryClient.invalidateQueries({ queryKey: ['social-accounts'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteAccount = useMutation({
    mutationFn: (id: string) => api.delete(`/social/accounts/${id}`),
    onSuccess: () => {
      toast.success('Account removed');
      void queryClient.invalidateQueries({ queryKey: ['social-accounts'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const testAccount = useMutation({
    mutationFn: (id: string) => api.post<{ ok: boolean; detail?: string }>(`/social/accounts/${id}/test`),
    onSuccess: (data) => {
      if (data.ok) toast.success(data.detail ?? 'Connected');
      else toast.error(data.detail ?? 'Connection failed');
      void queryClient.invalidateQueries({ queryKey: ['social-accounts'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const runActionMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.post<{ ok: boolean; detail?: string; runId: string }>('/social/run', body),
    onSuccess: (data) => {
      if (data.ok) toast.success(data.detail ?? 'Action completed');
      else toast.error(data.detail ?? 'Action failed');
      setRunOpen(false);
      setRunAccountId('');
      setRunActionName('x_follow');
      setRunInput('');
      setRunProxy('');
      void queryClient.invalidateQueries({ queryKey: ['social-runs'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function parseJson(text: string): Record<string, unknown> {
    if (!text.trim()) return {};
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new Error('Invalid JSON in credentials/input field');
    }
  }

  return (
    <>
      <PageHeader
        title="Social Automation"
        description="Off-chain account management with per-account proxy routing (Gmail, X, Discord)"
        actions={
          <>
            <Button size="sm" variant="secondary" onClick={() => setRunOpen(true)}>
              <Play className="size-4" aria-hidden />
              Run action
            </Button>
            <Button size="sm" onClick={() => setAccountOpen(true)}>
              <Plus className="size-4" aria-hidden />
              Add account
            </Button>
          </>
        }
      />

      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Accounts</CardTitle>
          </CardHeader>
          <CardContent>
            {accounts.isLoading ? (
              <TableSkeleton rows={3} />
            ) : (accounts.data?.length ?? 0) === 0 ? (
              <EmptyState
                title="No accounts"
                description="Connect Gmail, X, or Discord accounts. Credentials are AES-256-GCM encrypted at rest and every request routes through the account's proxy."
                action={
                  <Button size="sm" variant="secondary" onClick={() => setAccountOpen(true)}>
                    <Plus className="size-4" aria-hidden />
                    Add account
                  </Button>
                }
              />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Platform</TH>
                    <TH>Username</TH>
                    <TH>Proxy</TH>
                    <TH>Status</TH>
                    <TH>Added</TH>
                    <TH />
                  </TR>
                </THead>
                <TBody>
                  {accounts.data?.map((a) => (
                    <TR key={a.id}>
                      <TD className="font-medium">{a.platform}</TD>
                      <TD className="text-text-secondary">{a.username}</TD>
                      <TD className="mono text-xs text-text-secondary">{a.proxy ? '✓ configured' : '-'}</TD>
                      <TD>
                        <span
                          className={
                            a.status === 'connected'
                              ? 'text-success'
                              : a.status === 'error'
                                ? 'text-danger'
                                : 'text-text-muted'
                          }
                        >
                          {a.status}
                        </span>
                      </TD>
                      <TD className="text-text-secondary">{format(new Date(a.createdAt), 'd MMM yyyy')}</TD>
                      <TD>
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label="Test connection"
                            loading={testAccount.isPending && testAccount.variables === a.id}
                            onClick={() => testAccount.mutate(a.id)}
                          >
                            <PlugZap className="size-3.5" aria-hidden />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label="Delete account"
                            onClick={() => {
                              if (confirm(`Remove ${a.platform} account ${a.username}?`)) {
                                deleteAccount.mutate(a.id);
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
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent runs</CardTitle>
          </CardHeader>
          <CardContent>
            {runs.isLoading ? (
              <TableSkeleton rows={3} />
            ) : (runs.data?.data.length ?? 0) === 0 ? (
              <EmptyState title="No runs yet" description="Run a social action to see results here." />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Action</TH>
                    <TH>Status</TH>
                    <TH>Detail</TH>
                    <TH>Ran at</TH>
                  </TR>
                </THead>
                <TBody>
                  {runs.data?.data.map((r) => (
                    <TR key={r.id}>
                      <TD className="mono text-xs">{r.action}</TD>
                      <TD>
                        <span
                          className={
                            r.status === 'completed'
                              ? 'text-success'
                              : r.status === 'failed'
                                ? 'text-danger'
                                : 'text-text-muted'
                          }
                        >
                          {r.status}
                        </span>
                      </TD>
                      <TD className="max-w-xs truncate text-text-secondary">
                        {r.error ?? (typeof r.result === 'string' ? r.result : r.result ? JSON.stringify(r.result) : '-')}
                      </TD>
                      <TD className="text-text-secondary">{format(new Date(r.createdAt), 'd MMM HH:mm:ss')}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Add account dialog */}
      <Dialog open={accountOpen} onClose={() => setAccountOpen(false)} title="Add social account">
        <div className="flex flex-col gap-4">
          <Field label="Platform">
            <Select value={platform} onChange={(e) => setPlatform(e.target.value)}>
              {PLATFORMS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Username">
            <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="@handle / email" />
          </Field>
          <Field
            label="Credentials (JSON)"
            hint={
              platform === 'x'
                ? '{ "authToken": "...", "cookies": "...", "csrf": "..." }'
                : platform === 'discord'
                  ? '{ "apiKey": "..." }'
                  : '{ "cookies": "..." }'
            }
          >
            <TextArea
              value={credentials}
              onChange={(e) => setCredentials(e.target.value)}
              placeholder='{ "authToken": "..." }'
              rows={4}
              className="mono text-xs"
            />
          </Field>
          <Field label="Proxy (optional)" hint="http://user:pass@host:port or socks5://host:port">
            <Input
              value={proxy}
              onChange={(e) => setProxy(e.target.value)}
              placeholder="socks5://127.0.0.1:1080"
              className="mono text-xs"
            />
          </Field>
          <Button
            onClick={() => {
              try {
                const creds = parseJson(credentials);
                createAccount.mutate({ platform, username, credentials: creds, proxy: proxy || null });
              } catch (e) {
                toast.error((e as Error).message);
              }
            }}
            loading={createAccount.isPending}
          >
            Add account
          </Button>
        </div>
      </Dialog>

      {/* Run action dialog */}
      <Dialog open={runOpen} onClose={() => setRunOpen(false)} title="Run social action">
        <div className="flex flex-col gap-4">
          <Field label="Account (optional)" hint="Uses the account's stored credentials + proxy">
            <Select value={runAccountId} onChange={(e) => setRunAccountId(e.target.value)}>
              <option value="">None (use inline credentials)</option>
              {accounts.data?.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.platform} — {a.username}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Action">
            <Select value={runActionName} onChange={(e) => setRunActionName(e.target.value)}>
              {ACTIONS.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Input (JSON)" hint={actionHint(runActionName)}>
            <TextArea
              value={runInput}
              onChange={(e) => setRunInput(e.target.value)}
              placeholder='{ "userId": "..." }'
              rows={4}
              className="mono text-xs"
            />
          </Field>
          <Field label="Proxy override (optional)" hint="Overrides the account proxy for this run">
            <Input
              value={runProxy}
              onChange={(e) => setRunProxy(e.target.value)}
              placeholder="http://user:pass@host:port"
              className="mono text-xs"
            />
          </Field>
          <Button
            onClick={() => {
              try {
                const input = parseJson(runInput);
                runActionMutation.mutate({
                  accountId: runAccountId || null,
                  action: runActionName,
                  proxy: runProxy || null,
                  input,
                });
              } catch (e) {
                toast.error((e as Error).message);
              }
            }}
            loading={runActionMutation.isPending}
          >
            <ShieldCheck className="size-4" aria-hidden />
            Execute
          </Button>
        </div>
      </Dialog>
    </>
  );
}
