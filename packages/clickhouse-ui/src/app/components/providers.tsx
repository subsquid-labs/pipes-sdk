'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'

import { ServerProvider } from '~/api/server-context'

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            networkMode: 'always',
          },
        },
      }),
  )

  return (
    <QueryClientProvider client={queryClient}>
      <ServerProvider>{children}</ServerProvider>
    </QueryClientProvider>
  )
}
