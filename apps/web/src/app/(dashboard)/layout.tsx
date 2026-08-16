'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/lib/auth-store';
import { Sidebar } from '@/components/layout/sidebar';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const hydrated = useAuthStore((s) => s._hasHydrated);

  useEffect(() => {
    if (hydrated && !user) router.replace('/login');
  }, [hydrated, user, router]);

  if (!hydrated) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center">
        <p className="text-sm text-text-secondary">Loading…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center">
        <p className="text-sm text-text-secondary">Redirecting to sign in…</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-[100dvh]">
      <Sidebar />
      <main className="min-w-0 flex-1 px-8 py-8">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
