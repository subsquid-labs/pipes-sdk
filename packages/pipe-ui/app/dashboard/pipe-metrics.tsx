import NumberFlow from '@number-flow/react'
import { Terminal } from 'lucide-react'
// @ts-ignore
import { Sparklines, SparklinesLine } from 'react-sparklines'
import SyntaxHighlighter from 'react-syntax-highlighter'
import theme from 'react-syntax-highlighter/dist/esm/styles/hljs/hybrid'
import { useMetrics } from '~/api/metrics'
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { displayEstimatedTime, humanBytes } from '~/dashboard/formatters'
import { Profiler } from '~/dashboard/profiler'
import example from './code.example?raw'

const sparklineStyle = { fill: '#d0a9e2' }
// const sparklineStyle = { fill: 'rgba(255,255,255,1)' }
const sparklineColor = 'rgba(255,255,255,0.5)'

export function PipeMetrics() {
  const { data } = useMetrics()

  if (!data)
    return (
      <div className="w-full ">
        <Alert variant="destructive">
          <Terminal />
          <AlertTitle>Your pipe is offline!</AlertTitle>
          <AlertDescription>Please ensure that you run a pipeline and expose the metrics server</AlertDescription>
        </Alert>

        <div className="mt-10">
          <h1 className="mt-4 mb-2 font-medium">Get started with Pipes SDK</h1>

          <div className="mt-4">
            <h4 className="mb-1">1. Install npm package</h4>
            <div className="text-xs bg-gray-900 rounded-md p-2">
              <SyntaxHighlighter customStyle={{ background: 'transparent' }} language="bash" style={theme}>
                npm install @sqd-pipes/pipes
              </SyntaxHighlighter>
            </div>
          </div>

          <div className="mt-4">
            <h4 className="mb-1">2. Run a simple pipe</h4>
            <div className="text-xs bg-gray-900 rounded-md p-2">
              <SyntaxHighlighter customStyle={{ background: 'transparent' }} language="typescript" style={theme}>
                {example}
              </SyntaxHighlighter>
            </div>
          </div>

          <div className="mt-4">
            <h4 className="mb-1">3. Explore docs</h4>
            <div className="text-xs text-muted">// TODO</div>
          </div>
        </div>
      </div>
    )

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

        <Profiler />

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
