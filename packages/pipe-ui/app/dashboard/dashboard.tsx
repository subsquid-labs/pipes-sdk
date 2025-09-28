import NumberFlow from '@number-flow/react'

// @ts-ignore
import { Sparklines, SparklinesLine } from 'react-sparklines'

import { useMetrics } from '~/api/metrics'
import { Button } from '~/components/ui/button'
import { Logo } from '~/components/ui/logo'
import { displayEstimatedTime, humanBytes } from '~/dashboard/formatters'
import { Profiler } from '~/dashboard/profiler'

const sparklineStyle = { fill: '#d0a9e2' }
// const sparklineStyle = { fill: 'rgba(255,255,255,1)' }
const sparklineColor = 'rgba(255,255,255,0.5)'

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
            {/*<Card className="p-4 bg-background rounded-xl">*/}
            <div className="p-4 border rounded-xl">
              <div className="flex justify-between">
                <div>ethereum-mainnet</div>
                <div className="justify-end">
                  <div className="flex gap-1">
                    <NumberFlow value={data.progress.current}></NumberFlow>
                    <div className="text-muted">/</div>
                    <NumberFlow className="text-muted-foreground" value={data.progress.to}></NumberFlow>
                  </div>
                </div>
              </div>

              <div className="w-full h-4 overflow-hidden rounded-full bg-gradient-primary my-1.5">
                <div
                  style={{
                    width: data.progress.percent.toFixed(0) + '%',
                  }}
                  className="h-full gradient-primary rounded-full"
                />
              </div>

              <div className="flex justify-between mb-3 text-muted-foreground text-xs">
                <div>{displayEstimatedTime(data.progress.etaSeconds)}</div>
                <div>{data.progress.percent.toFixed(2)}%</div>
              </div>

              <Profiler />

              <div className="flex items-center justify-between font-medium text-muted-foreground text-xs opacity-60">
                <div className="flex items-center gap-1">
                  <div className="w-[100px] mr-2 bg-primary/2 rounded-sm overflow-hidden border test pt-2">
                    <Sparklines
                      min={0}
                      data={data.history.map((v) => v.blocksPerSecond)}
                      width={100}
                      height={32}
                      margin={0}
                    >
                      <SparklinesLine style={sparklineStyle} color={sparklineColor} />
                    </Sparklines>
                  </div>
                  <div>
                    <div className="text-xxs">Indexing speed</div>
                    <div>{data.speed.blocksPerSecond.toFixed(data.speed.blocksPerSecond > 1 ? 0 : 2)} blocks/sec</div>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-[100px] mr-2 bg-primary/2 rounded-sm overflow-hidden border test pt-2">
                    <Sparklines
                      min={0}
                      data={data.history.map((v) => v.bytesPerSecond)}
                      width={100}
                      height={32}
                      margin={0}
                    >
                      <SparklinesLine style={sparklineStyle} color={sparklineColor} />
                    </Sparklines>
                  </div>
                  <div>
                    <div className="text-xxs">Download speed</div>
                    <div>{humanBytes(data.speed.bytesPerSecond)}/sec</div>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-[100px] mr-2 bg-primary/2 rounded-sm overflow-hidden border test pt-2">
                    <Sparklines min={0} data={data.history.map((v) => v.memory)} width={100} height={32} margin={0}>
                      <SparklinesLine style={sparklineStyle} color={sparklineColor} />
                    </Sparklines>
                  </div>
                  <div>
                    <div className="text-xxs">Memory</div>
                    <div>{humanBytes(data.usage.memory)}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
