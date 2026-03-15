'use client'

import { useState } from 'react'

import { ArrowUpRightIcon } from 'lucide-react'

import { Button } from '~/components/ui/button'
import { Logo } from '~/components/ui/logo'
import { DashboardSkeleton } from '~/dashboard/dashboard-skeleton'
import { Pipeline } from '~/dashboard/pipeline'
import { Sidebar } from '~/dashboard/sidebar'
import { useStats } from '~/hooks/use-metrics'
import { ServerContext } from '~/hooks/use-server-context'
import { useServers } from '~/hooks/use-servers'

const DOCS_URL = 'https://beta.docs.sqd.dev'

export function Dashboard() {
  const [serverIndex, setServerIndex] = useState(0)
  const { data: servers } = useServers()

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
                <a href={`${DOCS_URL}/en/sdk/pipes-sdk/quickstart`} target="_blank">
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

  const pipeId = selectedPipe || pipes?.[0]?.id

  return (
    <div className="flex gap-10">
      <Sidebar pipes={pipes} selectedPipeId={pipeId} onSelectPipe={setSelectedPipe} />
      <Pipeline pipeId={pipeId} />
    </div>
  )
}
