'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Menu } from 'lucide-react';
import { useAuthStore } from '@/lib/auth-store';
import { Sidebar } from '@/components/layout/sidebar';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const hydrated = useAuthStore((s) => s._hasHydrated);
  const [mobileOpen, setMobileOpen] = useState(false);

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
    <div className="min-h-[100dvh]">
      <Sidebar open={mobileOpen} onClose={() => setMobileOpen(false)} />

      {/* Mobile top bar (hamburger) — hidden on desktop */}
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/90 px-4 backdrop-blur lg:hidden">
        <button
          onClick={() => setMobileOpen(true)}
          aria-label="Open menu"
          className="flex size-9 items-center justify-center rounded-[8px] border border-border bg-surface text-text-primary transition-colors hover:bg-surface-2"
        >
          <Menu className="size-5" />
        </button>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/ryunix-logo.svg" alt="Ryunix logo" className="size-5 rounded-[6px]" />
        <span className="text-sm font-semibold">Ryunix</span>
      </header>

      {/* Main content — offset by sidebar width on desktop, full width on mobile */}
      <main className="min-w-0 lg:pl-60">
        <div className="px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</div>
      </main>
    </div>
  );
}
