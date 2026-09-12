'use client';

import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 10_000 },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <Toaster
        theme="dark"
        position="top-right"
        closeButton
        richColors
        offset={16}
        duration={3500}
        toastOptions={{
          style: {
            background: 'rgba(20, 20, 20, 0.95)',
            backdropFilter: 'blur(8px)',
            border: '1px solid #262626',
            color: '#fafafa',
            fontSize: '13px',
            boxShadow: '0 8px 30px rgba(0, 0, 0, 0.5)',
          },
        }}
      />
    </QueryClientProvider>
  );
}
