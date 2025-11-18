import { ArrowUpRightIcon, Terminal } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import { Code } from '~/components/ui/code'
import example from './code.example?raw'

export function PipelineDisconnected() {
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
          <Code language="bash" className="text-xs">
            npm install @subsquid/pipes
          </Code>
        </div>

        <div className="mt-4">
          <h4 className="mb-1">2. Run a simple pipe</h4>
          <Code language="typescript" className="text-xs">
            {example}
          </Code>
        </div>

        <div className="mt-4">
          <h4 className="mb-1">3. Explore docs</h4>
          <div className="text-xs text-muted pt-2 pb-8">
            <Button size="xl" asChild variant="default">
              <a href={`${import.meta.env.VITE_DOCS_URL}/en/sdk/pipes-sdk/quickstart`} target="_blank">
                Documentation
                <ArrowUpRightIcon />
              </a>
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
