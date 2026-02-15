import { useState } from 'react'

import { ArrowUpRightIcon } from 'lucide-react'

import { useStats } from '~/api/metrics'
import { Button } from '~/components/ui/button'
import { Logo } from '~/components/ui/logo'
import { Pipeline } from '~/dashboard/pipeline'
import { Sidebar } from '~/dashboard/sidebar'

export function Dashboard() {
  const { data: stats } = useStats()

  const [selectedPipe, setSelectedPipe] = useState<string | null>(null)
  const pipes = stats?.pipes || []

  const pipeId = selectedPipe || pipes?.[0]?.id
  const showPipeSelector = pipes && pipes.length > 1

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
          <Sidebar />
          <div className="w-full">
            {showPipeSelector ? (
              <div className="flex gap-1 mb-3">
                {pipes.map((pipe) => (
                  <button
                    key={pipe.id}
                    onClick={() => setSelectedPipe(pipe.id)}
                    className={`px-3 py-1 text-xs rounded-md border transition-colors ${
                      pipe.id === pipeId
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-secondary/50 text-muted-foreground border-border hover:bg-secondary'
                    }`}
                  >
                    <div className="ta-left">
                      <div>{pipe.id}</div>
                      <div>{pipe.progress.percent.toFixed(2)}%</div>
                    </div>
                  </button>
                ))}
              </div>
            ) : null}
            <Pipeline pipeId={pipeId} />
          </div>
        </div>
      </div>
    </div>
  )
}
