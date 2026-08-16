'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Send } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export default function ProfilePage() {
  const user = useAuthStore((s) => s.user);
  const [code, setCode] = useState<string | null>(null);

  const pairCode = useMutation({
    mutationFn: () => api.post<{ code: string; expiresAt: string }>('/auth/telegram/pair-code'),
    onSuccess: (data) => {
      setCode(data.code);
      toast.success('Pairing code generated; valid for 15 minutes');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <>
      <PageHeader title="Profile" description="Account and notification settings" />

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Account</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <Row label="Username" value={user?.username ?? '-'} />
            <Row label="Email" value={user?.email ?? '-'} />
            <Row label="Role" value={user?.role ?? '-'} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Telegram notifications</CardTitle>
            {user?.telegramId ? (
              <Badge tone="success">linked</Badge>
            ) : (
              <Badge>not linked</Badge>
            )}
          </CardHeader>
          <CardContent className="flex flex-col gap-4 text-sm">
            {user?.telegramId ? (
              <p className="text-text-secondary">
                Task notifications are delivered to your linked Telegram account.
              </p>
            ) : (
              <>
                <p className="text-text-secondary">
                  Generate a pairing code, then send <span className="mono text-text-primary">/start {'<code>'}</span> to
                  the bot to receive task notifications on Telegram.
                </p>
                {code && (
                  <div className="rounded-[8px] border border-accent/30 bg-accent-subtle px-4 py-3">
                    <p className="label">Pairing code</p>
                    <p className="mono mt-1 text-lg tracking-[0.3em] text-accent">{code}</p>
                  </div>
                )}
                <Button
                  size="sm"
                  onClick={() => pairCode.mutate()}
                  loading={pairCode.isPending}
                  className="w-fit"
                >
                  <Send className="size-4" aria-hidden />
                  {code ? 'Generate new code' : 'Generate pairing code'}
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border pb-2 last:border-none">
      <span className="text-text-secondary">{label}</span>
      <span>{value}</span>
    </div>
  );
}
