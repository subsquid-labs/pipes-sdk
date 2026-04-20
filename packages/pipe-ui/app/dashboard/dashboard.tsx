'use client'

import { useEffect, useState } from 'react'

import { ArrowUpRightIcon } from 'lucide-react'

import { Button } from '~/components/ui/button'
import { Logo } from '~/components/ui/logo'
import { DashboardSkeleton } from '~/dashboard/dashboard-skeleton'
import { Pipeline } from '~/dashboard/pipeline'
import { Sidebar } from '~/dashboard/sidebar'
import { useStats } from '~/hooks/use-metrics'
import { ServerContext } from '~/hooks/use-server-context'
import { useServers } from '~/hooks/use-servers'
import { useUrlParam } from '~/hooks/use-url-param'

const DOCS_URL = 'https://beta.docs.sqd.dev'

export function Dashboard() {
  const [rawServerIndex, setServerIndex] = useUrlParam('server', 0, {
    validate: (v) => Number.isInteger(v) && v >= 0,
  })
  const { data: servers } = useServers()

  // Never let an unvalidated out-of-range URL index reach `/api/metrics/*`
  // (the proxy 400s on unknown indices). Until servers are loaded, fall back
  // to the default server (0); once loaded, clamp and rewrite the URL.
  const serverIndex = !servers ? 0 : rawServerIndex >= servers.length ? 0 : rawServerIndex
  useEffect(() => {
    if (servers && rawServerIndex >= servers.length) setServerIndex(0)
  }, [servers, rawServerIndex, setServerIndex])

  return (
    <ServerContext value={{ serverIndex, setServerIndex }}>
      <div className="flex flex-col items-center pt-16 pb-4 gap-10 content-fade-in">
        <div className="max-w-[1000px] w-full">
          <div className="flex justify-between items-center">
            <div className="flex self-start mb-8">
              <Logo />
            </div>
            <div className="flex items-center gap-3 mb-8">
              <Button asChild variant="outline">
                <a href={`${DOCS_URL}/en/sdk/pipes-sdk/quickstart`} target="_blank" rel="noopener noreferrer">
                  Documentation
                  <ArrowUpRightIcon />
                </a>
              </Button>
            </div>
          </div>
          <DashboardInner serverIndex={serverIndex} />
        </div>
      </div>
    </ServerContext>
  )
}

function DashboardInner({ serverIndex }: { serverIndex: number }) {
  const { data: stats, isLoading } = useStats(serverIndex)
  const [selectedPipe, setSelectedPipe] = useState<string | null>(null)

  if (isLoading) return <DashboardSkeleton />
  const pipes = stats?.pipes || []

  // If the selection is not present on the current server, fall back to the
  // first pipe of that server. This keeps the cross-server switch transparent:
  // the user's selection is preserved when they switch back, but a "pipe is
  // offline" panel never appears just because the old id doesn't exist here.
  const hasSelected = selectedPipe != null && pipes.some((p) => p.id === selectedPipe)
  const pipeId = hasSelected ? (selectedPipe as string) : pipes?.[0]?.id

  return (
    <div className="flex gap-10">
      <Sidebar pipes={pipes} selectedPipeId={pipeId} onSelectPipe={setSelectedPipe} />
      <Pipeline pipeId={pipeId} />
    </div>
  )
}
