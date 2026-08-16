'use client';

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Save } from 'lucide-react';
import type { SystemConfigView } from '@mintbot/shared';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Field, Input } from '@/components/ui/input';

interface ConfigForm {
  defaultGasLimit: number;
  defaultMaxFeeGwei: number;
  defaultPriorityGwei: number;
  scheduleRefreshSec: number;
  txMaxAttempts: number;
  pendingTimeoutSec: number;
  receiptPollBaseMs: number;
  receiptPollMaxMs: number;
  replacementBumpBps: number;
  openseaApiKey: string;
}

export default function AdminConfigPage() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<ConfigForm | null>(null);

  const config = useQuery({
    queryKey: ['admin-config'],
    queryFn: () => api.get<SystemConfigView>('/admin/config'),
  });

  useEffect(() => {
    if (config.data) {
      setForm({
        defaultGasLimit: config.data.defaultGasLimit,
        defaultMaxFeeGwei: config.data.defaultMaxFeeGwei,
        defaultPriorityGwei: config.data.defaultPriorityGwei,
        scheduleRefreshSec: config.data.scheduleRefreshSec,
        txMaxAttempts: config.data.txMaxAttempts,
        pendingTimeoutSec: config.data.pendingTimeoutSec,
        receiptPollBaseMs: config.data.receiptPollBaseMs,
        receiptPollMaxMs: config.data.receiptPollMaxMs,
        replacementBumpBps: config.data.replacementBumpBps,
        openseaApiKey: '',
      });
    }
  }, [config.data]);

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch('/admin/config', body),
    onSuccess: () => {
      toast.success('Configuration saved');
      void queryClient.invalidateQueries({ queryKey: ['admin-config'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (!form) {
    return <p className="text-sm text-text-secondary">Loading configuration...</p>;
  }

  const num = (key: keyof ConfigForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [key]: Number(e.target.value) });

  return (
    <>
      <PageHeader
        title="System config"
        description="Engine defaults applied to every new task"
        actions={
          <Button
            size="sm"
            loading={save.isPending}
            onClick={() => {
              const body: Record<string, unknown> = { ...form };
              if (!form.openseaApiKey) delete body.openseaApiKey;
              save.mutate(body);
            }}
          >
            <Save className="size-4" aria-hidden />
            Save changes
          </Button>
        }
      />

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Defaults</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <Field label="Gas limit">
              <Input type="number" value={form.defaultGasLimit} onChange={num('defaultGasLimit')} />
            </Field>
            <Field label="Max fee (gwei)">
              <Input type="number" step="0.001" value={form.defaultMaxFeeGwei} onChange={num('defaultMaxFeeGwei')} />
            </Field>
            <Field label="Priority tip (gwei)">
              <Input type="number" step="0.001" value={form.defaultPriorityGwei} onChange={num('defaultPriorityGwei')} />
            </Field>
            <Field label="Schedule refresh (s)">
              <Input type="number" value={form.scheduleRefreshSec} onChange={num('scheduleRefreshSec')} />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Execution engine</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <Field label="Tx max attempts">
              <Input type="number" value={form.txMaxAttempts} onChange={num('txMaxAttempts')} />
            </Field>
            <Field label="Pending timeout (s)">
              <Input type="number" value={form.pendingTimeoutSec} onChange={num('pendingTimeoutSec')} />
            </Field>
            <Field label="Receipt poll base (ms)">
              <Input type="number" value={form.receiptPollBaseMs} onChange={num('receiptPollBaseMs')} />
            </Field>
            <Field label="Receipt poll max (ms)">
              <Input type="number" value={form.receiptPollMaxMs} onChange={num('receiptPollMaxMs')} />
            </Field>
            <Field label="Replacement bump (bps)">
              <Input type="number" value={form.replacementBumpBps} onChange={num('replacementBumpBps')} />
            </Field>
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>OpenSea API</CardTitle>
            <Badge tone={config.data?.openseaApiKeySet ? 'success' : 'neutral'}>
              {config.data?.openseaApiKeySet ? 'key set' : 'no key'}
            </Badge>
          </CardHeader>
          <CardContent>
            <Field
              label="API key"
              hint="Required for allowlist/FCFS mints. Stored encrypted; leave blank to keep the current key."
            >
              <Input
                type="password"
                value={form.openseaApiKey}
                onChange={(e) => setForm({ ...form, openseaApiKey: e.target.value })}
                placeholder={config.data?.openseaApiKeySet ? '•••••••• (unchanged)' : 'sk-...'}
              />
            </Field>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
