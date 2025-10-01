import NumberFlow from '@number-flow/react'
// @ts-ignore
import { Sparklines, SparklinesLine } from 'react-sparklines'
import { useMetrics } from '~/api/metrics'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs'
import { displayEstimatedTime, humanBytes } from '~/dashboard/formatters'
import { PipelineDisconnected } from '~/dashboard/pipeline-disconnected'
import { Profiler } from '~/dashboard/profiler'
import { TransformationExemplar } from '~/dashboard/transformation-exemplar'

const sparklineStyle = { fill: '#d0a9e2' }
// const sparklineStyle = { fill: 'rgba(255,255,255,1)' }
const sparklineColor = 'rgba(255,255,255,0.5)'

export function Pipeline() {
  const { data } = useMetrics()

  if (!data) return <PipelineDisconnected />

  return (
    <div className="w-full">
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

        <Tabs className="mt-4 mb-6" defaultValue="profiler">
          <TabsList className="bg-gray-950">
            <TabsTrigger className="" value="profiler">
              Profiler
            </TabsTrigger>
            <TabsTrigger value="data-flow">Data flow</TabsTrigger>
          </TabsList>
          <TabsContent value="profiler">
            <Profiler />
          </TabsContent>
          <TabsContent value="data-flow">
            <TransformationExemplar />
          </TabsContent>
        </Tabs>

        <div className="flex items-center justify-between font-medium text-muted-foreground text-xs opacity-60">
          <div className="flex items-center gap-1">
            <div className="w-[100px] mr-2 bg-primary/2 rounded-sm overflow-hidden border test pt-2">
              <Sparklines min={0} data={data.history.map((v) => v.blocksPerSecond)} width={100} height={32} margin={0}>
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
              <Sparklines min={0} data={data.history.map((v) => v.bytesPerSecond)} width={100} height={32} margin={0}>
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
  )
}
