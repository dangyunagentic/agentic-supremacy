export function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded-[8px] bg-surface-2 ${className ?? ''}`} />;
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3 p-5">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}
