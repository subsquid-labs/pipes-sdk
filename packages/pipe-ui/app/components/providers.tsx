'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { ThemeProvider } from '~/components/theme-provider'

const queryClient = new QueryClient()

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>{children}</ThemeProvider>
    </QueryClientProvider>
  )
}
