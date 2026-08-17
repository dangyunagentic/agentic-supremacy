'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Activity,
  ArrowLeftRight,
  BadgeCheck,
  Blocks,
  Gauge,
  Layers,
  LayoutDashboard,
  LogOut,
  ScrollText,
  Settings,
  UserCircle,
  Wallet,
  X,
} from 'lucide-react';
import { useAuthStore } from '@/lib/auth-store';
import { closeSocket } from '@/lib/socket';
import { logoutServer } from '@/lib/api';
import { cn } from '@/lib/utils';

const userNav = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/tasks', label: 'Tasks', icon: Layers },
  { href: '/eligibility', label: 'Eligibility', icon: BadgeCheck },
  { href: '/transfers', label: 'Transfers', icon: ArrowLeftRight },
  { href: '/wallets', label: 'Wallets', icon: Wallet },
  { href: '/rpc', label: 'RPC endpoints', icon: Gauge },
  { href: '/chains', label: 'Chains', icon: Blocks },
  { href: '/profile', label: 'Profile', icon: UserCircle },
];

const adminNav = [
  { href: '/admin', label: 'Users', icon: UserCircle },
  { href: '/admin/chains', label: 'Chains', icon: Blocks },
  { href: '/admin/config', label: 'System config', icon: Settings },
  { href: '/admin/audit', label: 'Audit log', icon: ScrollText },
];

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuthStore();

  // Auto-close the drawer whenever the route changes (mobile nav).
  useEffect(() => {
    onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Lock body scroll while the mobile drawer is open.
  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  const onLogout = () => {
    closeSocket();
    void logoutServer();
    logout();
    router.push('/login');
  };

  const link = (item: (typeof userNav)[number]) => {
    const active =
      item.href === '/admin'
        ? pathname === '/admin'
        : pathname === item.href || pathname.startsWith(`${item.href}/`);
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={onClose}
        className={cn(
          'flex items-center gap-3 rounded-[8px] px-3 py-2 text-sm transition-colors',
          active
            ? 'bg-accent-subtle text-accent'
            : 'text-text-secondary hover:bg-surface-2 hover:text-text-primary',
        )}
      >
        <item.icon className="size-4 shrink-0" aria-hidden />
        {item.label}
      </Link>
    );
  };

  return (
    <>
      {/* Mobile backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={onClose}
          aria-hidden
        />
      )}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-60 flex-col border-r border-border bg-surface',
          'transition-transform duration-300 ease-in-out',
          'lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        {/* Brand */}
        <div className="flex h-16 shrink-0 items-center gap-2.5 border-b border-border px-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/ryunix-logo.svg"
            alt="Ryunix logo"
            className="size-8 shrink-0 rounded-[8px]"
          />
          <div className="min-w-0 flex-1 leading-tight">
            <p className="text-sm font-semibold">Ryunix</p>
            <p className="text-[11px] text-text-muted">SeaDrop automation</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close menu"
            className="rounded p-1.5 text-text-muted transition-colors hover:bg-surface-2 hover:text-text-primary lg:hidden"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Nav — scrollable when it overflows, footer stays pinned */}
        <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Main">
          <p className="label px-3 pb-2">Main</p>
          <div className="flex flex-col gap-1">{userNav.map(link)}</div>
          {user?.role === 'admin' && (
            <>
              <p className="label mt-6 px-3 pb-2">Admin</p>
              <div className="flex flex-col gap-1">{adminNav.map(link)}</div>
            </>
          )}
        </nav>

        {/* User footer */}
        <div className="shrink-0 border-t border-border p-3">
          <div className="flex items-center justify-between rounded-[8px] px-2 py-1.5">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{user?.username}</p>
              <p className="flex items-center gap-1 text-[11px] text-text-muted">
                <Activity className="size-3" aria-hidden />
                {user?.role === 'admin' ? 'Administrator' : 'Member'}
              </p>
            </div>
            <button
              onClick={onLogout}
              aria-label="Log out"
              className="rounded p-2 text-text-muted transition-colors hover:bg-surface-2 hover:text-danger"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
