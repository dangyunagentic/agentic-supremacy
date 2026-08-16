'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { Coins } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { api, ApiError } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';

interface AuthResponse {
  user: {
    id: string;
    username: string;
    email: string;
    role: 'user' | 'admin';
    telegramId: string | null;
  };
  accessToken: string;
  refreshToken: string;
}

export default function RegisterPage() {
  const router = useRouter();
  const setSession = useAuthStore((s) => s.setSession);
  const [form, setForm] = useState({ username: '', email: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const data = await api.post<AuthResponse>('/auth/register', form);
      setSession(
        {
          id: data.user.id,
          username: data.user.username,
          email: data.user.email,
          role: data.user.role,
          telegramId: data.user.telegramId,
        },
        data.accessToken,
        data.refreshToken,
      );
      toast.success('Account created');
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-[100dvh] items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <span className="flex size-10 items-center justify-center rounded-[8px] bg-accent-subtle text-accent">
            <Coins className="size-5" aria-hidden />
          </span>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Create your account</h1>
            <p className="mt-1 text-sm text-text-secondary">One minute and your first mint is armed</p>
          </div>
        </div>

        <form
          onSubmit={onSubmit}
          className="flex flex-col gap-4 rounded-[10px] border border-border bg-surface p-6"
        >
          <Field label="Username">
            <Input
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              placeholder="satoshi"
              minLength={3}
              required
            />
          </Field>
          <Field label="Email">
            <Input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
          </Field>
          <Field label="Password" hint="At least 10 characters">
            <Input
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              autoComplete="new-password"
              minLength={10}
              required
            />
          </Field>
          {error && <p className="text-sm text-danger">{error}</p>}
          <Button type="submit" loading={loading} className="mt-1 w-full">
            Create account
          </Button>
          <p className="text-center text-sm text-text-secondary">
            Already registered?{' '}
            <Link href="/login" className="text-accent hover:underline">
              Sign in
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
