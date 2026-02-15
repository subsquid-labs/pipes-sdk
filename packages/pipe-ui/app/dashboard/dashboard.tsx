import { useState } from 'react'

import { ArrowUpRightIcon } from 'lucide-react'

import { useStats } from '~/api/metrics'
import { Button } from '~/components/ui/button'
import { Logo } from '~/components/ui/logo'
import { Pipeline } from '~/dashboard/pipeline'
import { Sidebar } from '~/dashboard/sidebar'

export function Dashboard() {
  const { data: stats, isError } = useStats()

  const [selectedPipe, setSelectedPipe] = useState<string | null>(null)
  const pipes = stats?.pipes || []

  // TODO handle case when selected pipe is not in the list anymore (e.g. deleted)
  const pipeId = selectedPipe || pipes?.[0]?.id

  return (
    <div className="flex flex-col items-center pt-16 pb-4 gap-10">
      <div className="max-w-[1000px] w-full">
        <div className="flex justify-between">
          <div className="flex self-start mb-8">
            <Logo />
          </div>
          <Button asChild variant="outline">
            <a href={`${import.meta.env.VITE_DOCS_URL}/en/sdk/pipes-sdk/quickstart`} target="_blank">
              Documentation
              <ArrowUpRightIcon />
            </a>
          </Button>
        </div>
        <div className="flex gap-10">
          <Sidebar pipes={pipes} selectedPipeId={pipeId} isError={isError} onSelectPipe={setSelectedPipe} />
          <Pipeline pipeId={pipeId} />
        </div>
      </div>
    </div>
  )
}
