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

export default function LoginPage() {
  const router = useRouter();
  const setSession = useAuthStore((s) => s.setSession);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const data = await api.post<AuthResponse>('/auth/login', { email, password });
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
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign in failed');
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
            <h1 className="text-lg font-semibold tracking-tight">Sign in to Mintbot</h1>
            <p className="mt-1 text-sm text-text-secondary">
              SeaDrop mint automation across chains
            </p>
          </div>
        </div>

        <form
          onSubmit={onSubmit}
          className="flex flex-col gap-4 rounded-[10px] border border-border bg-surface p-6"
        >
          <Field label="Email">
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
          </Field>
          <Field label="Password">
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Your password"
              autoComplete="current-password"
              required
            />
          </Field>
          {error && <p className="text-sm text-danger">{error}</p>}
          <Button type="submit" loading={loading} className="mt-1 w-full">
            Sign in
          </Button>
          <p className="text-center text-sm text-text-secondary">
            No account?{' '}
            <Link href="/register" className="text-accent hover:underline">
              Create one
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
