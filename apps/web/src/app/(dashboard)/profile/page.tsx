'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { KeyRound } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function ProfilePage() {
  const user = useAuthStore((s) => s.user);

  return (
    <>
      <PageHeader title="Profile" description="Account settings" />

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
            <CardTitle>Change password</CardTitle>
          </CardHeader>
          <CardContent>
            <ChangePasswordForm />
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function ChangePasswordForm() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const changePassword = useMutation({
    mutationFn: () =>
      api.post('/auth/change-password', {
        currentPassword,
        newPassword,
      }),
    onSuccess: () => {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      toast.success('Password changed successfully');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const passwordMismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;
  const tooShort = newPassword.length > 0 && newPassword.length < 10;

  return (
    <form
      className="flex flex-col gap-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        if (newPassword !== confirmPassword) {
          toast.error('New passwords do not match');
          return;
        }
        changePassword.mutate();
      }}
    >
      <label className="flex flex-col gap-1">
        <span className="text-text-secondary">Current password</span>
        <input
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          className="rounded-[8px] border border-border bg-surface px-3 py-2 outline-none focus:border-accent"
          required
          autoComplete="current-password"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-text-secondary">New password</span>
        <input
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          className="rounded-[8px] border border-border bg-surface px-3 py-2 outline-none focus:border-accent"
          required
          minLength={10}
          autoComplete="new-password"
        />
        {tooShort && (
          <span className="text-xs text-red-400">Minimum 10 characters</span>
        )}
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-text-secondary">Confirm new password</span>
        <input
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          className="rounded-[8px] border border-border bg-surface px-3 py-2 outline-none focus:border-accent"
          required
          minLength={10}
          autoComplete="new-password"
        />
        {passwordMismatch && (
          <span className="text-xs text-red-400">Passwords do not match</span>
        )}
      </label>

      <Button
        type="submit"
        size="sm"
        className="w-fit"
        loading={changePassword.isPending}
        disabled={passwordMismatch || tooShort}
      >
        <KeyRound className="size-4" aria-hidden />
        Update password
      </Button>
    </form>
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
