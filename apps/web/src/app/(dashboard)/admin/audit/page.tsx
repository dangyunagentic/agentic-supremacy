'use client';

import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import type { AuditLogView, Paginated } from '@mintbot/shared';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { TableSkeleton } from '@/components/ui/skeleton';

export default function AdminAuditPage() {
  const audit = useQuery({
    queryKey: ['admin-audit'],
    queryFn: () => api.get<Paginated<AuditLogView>>('/admin/audit-log?page=1&limit=50'),
  });

  return (
    <>
      <PageHeader title="Audit log" description="Every administrative action, newest first" />

      <Card>
        {audit.isLoading ? (
          <TableSkeleton rows={8} />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>When</TH>
                <TH>Admin</TH>
                <TH>Action</TH>
                <TH>Target</TH>
                <TH>Details</TH>
              </TR>
            </THead>
            <TBody>
              {audit.data?.data.map((entry) => (
                <TR key={entry.id}>
                  <TD className="whitespace-nowrap text-text-secondary">
                    {format(new Date(entry.createdAt), 'd MMM HH:mm:ss')}
                  </TD>
                  <TD>{entry.adminUsername ?? entry.adminId.slice(0, 8)}</TD>
                  <TD>
                    <Badge tone="accent">{entry.action}</Badge>
                  </TD>
                  <TD className="text-text-secondary">
                    {entry.targetType} <span className="mono text-xs">{entry.targetId.slice(0, 12)}</span>
                  </TD>
                  <TD className="mono max-w-64 truncate text-xs text-text-muted">
                    {JSON.stringify(entry.metadata)}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}
