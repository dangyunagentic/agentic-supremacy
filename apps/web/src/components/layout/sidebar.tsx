'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Activity,
  ArrowLeftRight,
  BadgeCheck,
  Blocks,
  Coins,
  Gauge,
  Layers,
  LayoutDashboard,
  LogOut,
  ScrollText,
  Settings,
  UserCircle,
  Wallet,
} from 'lucide-react';
import { useAuthStore } from '@/lib/auth-store';
import { closeSocket } from '@/lib/socket';
import { cn } from '@/lib/utils';

const userNav = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/tasks', label: 'Tasks', icon: Layers },
  { href: '/eligibility', label: 'Eligibility', icon: BadgeCheck },
  { href: '/transfers', label: 'Transfers', icon: ArrowLeftRight },
  { href: '/wallets', label: 'Wallets', icon: Wallet },
  { href: '/rpc', label: 'RPC endpoints', icon: Gauge },
  { href: '/profile', label: 'Profile', icon: UserCircle },
];

const adminNav = [
  { href: '/admin', label: 'Users', icon: UserCircle },
  { href: '/admin/chains', label: 'Chains', icon: Blocks },
  { href: '/admin/config', label: 'System config', icon: Settings },
  { href: '/admin/audit', label: 'Audit log', icon: ScrollText },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuthStore();

  const onLogout = () => {
    closeSocket();
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
        className={cn(
          'flex items-center gap-3 rounded-[8px] px-3 py-2 text-sm transition-colors',
          active
            ? 'bg-accent-subtle text-accent'
            : 'text-text-secondary hover:bg-surface-2 hover:text-text-primary',
        )}
      >
        <item.icon className="size-4" aria-hidden />
        {item.label}
      </Link>
    );
  };

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-border bg-surface/50">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <span className="flex size-8 items-center justify-center rounded-[8px] bg-accent-subtle text-accent">
          <Coins className="size-4" aria-hidden />
        </span>
        <div className="leading-tight">
          <p className="text-sm font-semibold">Mintbot</p>
          <p className="text-[11px] text-text-muted">SeaDrop automation</p>
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-1 px-3" aria-label="Main">
        {userNav.map(link)}
        {user?.role === 'admin' && (
          <>
            <p className="label mt-6 px-3 pb-1">Admin</p>
            {adminNav.map(link)}
          </>
        )}
      </nav>

      <div className="border-t border-border p-3">
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
  );
}
