import Link from 'next/link'
import type { ReactNode } from 'react'
import './globals.css'
import { Separator } from '~/components/ui/separator'
import { fetchClickhouseVersion } from '~/db/clickhouse'

export const metadata = {
  title: 'ClickHouse',
  description: '',
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  let version: string | null = null
  try {
    version = await fetchClickhouseVersion()
  } catch (e) {
    console.error('Error fetching ClickHouse version:', e)
  }

  return (
    <html lang="en">
      <body className="dark">
        <header className="sticky top-0 z-10 border-b border-border/80 bg-slate-950/95 backdrop-blur">
          <div className="mx-auto flex max-w-[1200px] items-center justify-between py-3 text-slate-100">
            <div className="flex items-center gap-4">
              <div className="text-lg font-semibold">ClickHouse</div>
              <Separator className="h-6 w-[1px]" />
              <nav className="flex items-center gap-3 text-sm font-medium text-slate-200">
                <Link className="text-white no-underline hover:text-primary" href="/tables">
                  Tables
                </Link>
                <Link className="text-white no-underline hover:text-primary" href="/queries">
                  Queries
                </Link>
              </nav>
            </div>
            <div className="text-xs text-slate-400">
              {version ? `ClickHouse v${version}` : 'ClickHouse version unavailable'}
            </div>
          </div>
        </header>
        {children}
      </body>
    </html>
  )
}
