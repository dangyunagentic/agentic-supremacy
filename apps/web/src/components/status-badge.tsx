import { TaskStatus } from '@mintbot/shared';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const STATUS_META: Record<TaskStatus, { label: string; tone: 'neutral' | 'accent' | 'success' | 'warning' | 'danger'; pulse?: boolean }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  scheduled: { label: 'Scheduled', tone: 'accent' },
  pre_flight: { label: 'Pre-flight', tone: 'accent' },
  calldata: { label: 'Calldata', tone: 'accent' },
  pre_sign: { label: 'Pre-sign', tone: 'warning' },
  dispatching: { label: 'Dispatching', tone: 'warning', pulse: true },
  awaiting_receipt: { label: 'Awaiting receipt', tone: 'warning' },
  completed: { label: 'Completed', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

export function StatusBadge({ status, className }: { status: TaskStatus; className?: string }) {
  const meta = STATUS_META[status] ?? { label: status, tone: 'neutral' as const };
  return (
    <Badge tone={meta.tone} className={className}>
      <span
        className={cn(
          'inline-block size-1.5 rounded-full bg-current',
          meta.pulse && 'animate-pulse',
        )}
        aria-hidden
      />
      {meta.label}
    </Badge>
  );
}

export function ResultStatusBadge({ status }: { status: string }) {
  const tone =
    status === 'success'
      ? 'success'
      : status === 'pending' || status === 'signed' || status === 'dispatched'
        ? 'warning'
        : 'danger';
  return <Badge tone={tone}>{status}</Badge>;
}
