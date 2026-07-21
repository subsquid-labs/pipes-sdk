'use client'

import { useEffect, useState } from 'react'

import { ArrowLeft, ArrowUpRightIcon, Search } from 'lucide-react'
import Link from 'next/link'

import { CommandPalette } from '~/components/command-palette/command-palette'
import { DOCS_URL } from '~/components/command-palette/registry'
import { Button } from '~/components/ui/button'
import { Logo } from '~/components/ui/logo'
import { DashboardSkeleton } from '~/dashboard/dashboard-skeleton'
import { Overview } from '~/dashboard/overview'
import { Pipeline } from '~/dashboard/pipeline'
import { Sidebar } from '~/dashboard/sidebar'
import { useStats } from '~/hooks/use-metrics'
import { ServerContext, useServerIndex } from '~/hooks/use-server-context'
import { useServers } from '~/hooks/use-servers'
import { useUrlNavigate, useUrlParam } from '~/hooks/use-url-param'

export function Dashboard() {
  const [parsedServerIndex, , serverParam] = useUrlParam('server', 0, {
    validate: (v) => Number.isInteger(v) && v >= 0,
  })
  const [pipeId] = useUrlParam('pipe', '')
  const { data: servers } = useServers()
  const navigate = useUrlNavigate()
  const [paletteOpen, setPaletteOpen] = useState(false)

  // Never let an invalid or out-of-range URL index reach `/api/metrics/*`
  // (the proxy 400s on unknown indices). A missing server token still means
  // the default server, including while a valid empty configuration is loaded.
  const isServerOutOfRange = serverParam.raw !== null && servers !== undefined && parsedServerIndex >= servers.length
  const shouldResetServerSelection = !serverParam.isValid || isServerOutOfRange
  const serverIndex = !servers || shouldResetServerSelection ? 0 : parsedServerIndex

  useEffect(() => {
    if (shouldResetServerSelection) navigate({ server: null, pipe: null, tab: null })
  }, [shouldResetServerSelection, navigate])

  return (
    <ServerContext value={{ serverIndex }}>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <div className="flex flex-col items-center pt-16 pb-4 gap-10 content-fade-in">
        <div className="max-w-[1000px] w-full">
          <div className="flex justify-between items-center">
            <div className="flex self-start mb-8">
              <Logo />
            </div>
            <div className="flex items-center gap-3 mb-8">
              <SearchButton onOpen={() => setPaletteOpen(true)} />
              <Button asChild variant="outline">
                <a href={`${DOCS_URL}/en/sdk/pipes-sdk/quickstart`} target="_blank" rel="noopener noreferrer">
                  Documentation
                  <ArrowUpRightIcon />
                </a>
              </Button>
            </div>
          </div>
          {pipeId ? <PipeDetail pipeId={pipeId} /> : <Overview />}
        </div>
      </div>
    </ServerContext>
  )
}

function SearchButton({ onOpen }: { onOpen: () => void }) {
  const [shortcutLabel, setShortcutLabel] = useState('⌘K')

  useEffect(() => {
    const platform = navigator.platform || navigator.userAgent
    if (!/Mac|iPhone|iPad/i.test(platform)) setShortcutLabel('Ctrl K')
  }, [])

  return (
    <Button variant="outline" onClick={onOpen}>
      <Search />
      Search...
      <kbd className="text-xxs text-muted-foreground border rounded px-1">{shortcutLabel}</kbd>
    </Button>
  )
}

function PipeDetail({ pipeId }: { pipeId: string }) {
  const { serverIndex } = useServerIndex()
  const { data: stats, isLoading } = useStats(serverIndex)
  const [, setPipeId] = useUrlParam('pipe', '')

  if (isLoading) return <DashboardSkeleton />

  return (
    <div>
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 mb-4 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="size-3.5" />
        All pipes
      </Link>
      <div className="flex gap-10">
        <Sidebar pipes={stats?.pipes || []} selectedPipeId={pipeId} onSelectPipe={setPipeId} />
        <Pipeline pipeId={pipeId} />
      </div>
    </div>
  )
}
