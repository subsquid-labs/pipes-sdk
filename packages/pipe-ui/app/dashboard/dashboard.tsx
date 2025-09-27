import NumberFlow from '@number-flow/react'

// @ts-ignore
import { Sparklines, SparklinesLine, SparklinesNormalBand } from 'react-sparklines'

import { useMetrics } from '~/api/prometheus'
import { Button } from '~/components/ui/button'
import { Logo } from '~/components/ui/logo'
import { displayEstimatedTime, humanBytes } from '~/dashboard/formatters'

export function Dashboard() {
  const { data } = useMetrics()

  if (!data) return <div>Loading...</div>

  return (
    <div className="flex flex-col items-center pt-16 pb-4 gap-10">
      <div className="max-w-[1000px] w-full">
        <div className="flex justify-between">
          <div className="flex self-start mb-8">
            <Logo />
          </div>

          <Button variant="outline">Documentation</Button>
        </div>

        <div className="flex gap-20">
          <div>
            <h1 className="text-2xl font-bold mb-2">Pipes SDK</h1>

            <div className="w-[200px] flex flex-col items-start text-xs gap-2">
              <div className="flex items-center gap-2">
                <div className="text-muted-foreground w-[60px]">Status</div>
                <div className="font-medium text-foreground flex items-center gap-1">
                  <div className="bg-teal-400 rounded-xl px-2 py-0.5 text-black text-xs">Running</div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <div className="text-muted-foreground w-[60px]">Version</div>
                <div className=" flex items-center gap-1">{data.sdk.version}</div>
              </div>
            </div>
          </div>
          <div className="w-full">
            <div className="mb-2 flex items-center justify-between text-sm font-medium">
              <div className="flex gap-3">
                {data.progress.percent.toFixed(2)}%{displayEstimatedTime(data.progress.etaSeconds)}
              </div>
              <div className="flex gap-1">
                <NumberFlow value={data.progress.current}></NumberFlow>
                <div className="text-muted">/</div>
                <NumberFlow className="text-muted-foreground" value={data.progress.to}></NumberFlow>
              </div>
            </div>

            <div className="w-full h-4 overflow-hidden rounded-full bg-gradient-primary mb-2">
              <div
                style={{
                  width: data.progress.percent.toFixed(0) + '%',
                }}
                className="h-full gradient-primary rounded-full"
              />
            </div>

            <div className="mb-2 flex items-center justify-between text-sm font-medium text-muted-foreground">
              <div className="flex items-center gap-1">
                <div className="w-[100px] mr-2 bg-primary/2 rounded-md overflow-hidden border">
                  <Sparklines min={0} data={data.history.map((v) => v.blocksPerSecond)} width={100} height={32}>
                    <SparklinesLine color="rgba(255,255,255,0.5)" />
                  </Sparklines>
                </div>
                <div className="text-xs">
                  <div>{data.speed.blocksPerSecond.toFixed(data.speed.blocksPerSecond > 1 ? 0 : 2)} blocks/sec</div>
                  <div>{humanBytes(data.speed.blocksPerSecond)}/sec</div>
                </div>
              </div>
              <div className="flex">
                <div className="w-[100px] mr-2 bg-primary/2 rounded-md overflow-hidden border">
                  <Sparklines min={0} data={data.history.map((v) => v.memory)} width={100} height={32}>
                    <SparklinesLine color="rgba(255,255,255,0.5)" />
                  </Sparklines>
                </div>
                <div className="text-xs">
                  <div>Memory</div>
                  <div>{humanBytes(data.usage.memory)}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
