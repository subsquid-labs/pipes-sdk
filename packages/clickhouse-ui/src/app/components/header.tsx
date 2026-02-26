'use client'

import Link from 'next/link'

import { useClickhouseVersion, useServers } from '~/api/clickhouse'
import { useServerIndex } from '~/api/server-context'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '~/components/ui/select'
import { Separator } from '~/components/ui/separator'

export function Header() {
  const { data: version } = useClickhouseVersion()
  const { data: servers } = useServers()
  const { serverIndex, setServerIndex } = useServerIndex()

  return (
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
        <div className="flex items-center gap-4">
          {servers && servers.length > 0 && (
            <Select
              value={String(serverIndex)}
              onValueChange={(v) => setServerIndex(Number(v))}
              disabled={servers.length === 1}
            >
              <SelectTrigger className="w-[180px] bg-slate-950 text-slate-100">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {servers.map((s) => (
                  <SelectItem key={s.index} value={String(s.index)}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <div className="text-xs text-slate-400">
            {version ? `v${version}` : ''}
          </div>
        </div>
      </div>
    </header>
  )
}
