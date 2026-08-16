import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

type Tone = 'accent' | 'success' | 'danger' | 'warning' | 'neutral';

const toneBox: Record<Tone, string> = {
  accent: 'bg-accent-subtle text-accent',
  success: 'bg-success-subtle text-success',
  danger: 'bg-danger-subtle text-danger',
  warning: 'bg-warning-subtle text-warning',
  neutral: 'bg-surface-2 text-text-secondary',
};

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = 'accent',
}: {
  label: string;
  value: string;
  hint?: string;
  icon?: ReactNode;
  tone?: Tone;
}) {
  return (
    <div className="rounded-[10px] border border-border bg-surface p-4 sm:p-5">
      <div className="flex items-center justify-between">
        <span className="label">{label}</span>
        {icon && (
          <span
            className={cn(
              'flex size-8 shrink-0 items-center justify-center rounded-[8px]',
              toneBox[tone],
            )}
          >
            {icon}
          </span>
        )}
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
      {hint && <p className="mt-1 text-xs text-text-muted">{hint}</p>}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      <p className="text-sm font-medium text-text-primary">{title}</p>
      <p className="max-w-sm text-sm text-text-secondary">{description}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
