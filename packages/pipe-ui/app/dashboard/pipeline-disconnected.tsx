'use client'

import { ArrowUpRightIcon, Terminal } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import { Code } from '~/components/ui/code'

const DOCS_URL = 'https://beta.docs.sqd.dev'

const example = `import { commonAbis, evmDecoder, evmPortalSource } from '@subsquid/pipes/evm'
import { metricsServer } from '@subsquid/pipes/metrics/node'

async function cli() {
  // Create a data stream from the Ethereum mainnet portal
  const stream = evmPortalSource({
    portal: 'https://portal.sqd.dev/datasets/ethereum-mainnet',
    outputs: {
      // Decode ERC-20 Transfer events starting from block 12,000,000
      erc20: evmDecoder({
        range: { from: '12,000,000' },
        events: {
          transfers: commonAbis.erc20.events.Transfer,
        },
      }),
    },

    /*
     * IMPORTANT!
     * ============================
     * Enable the metrics server to connect with the Pipe UI dashboard.
     * Without it, no metrics will be collected or displayed.
     * ============================
     */
    metrics: metricsServer(),
  })

  // Consume the stream and log the number of parsed transfers in each batch
  for await (const { data } of stream) {
    console.log(\`parsed \${data.erc20.transfers.length} transfers\`)
  }
}

void cli()`

export function PipelineDisconnected() {
  return (
    <div className="flex-1">
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
              <a href={`${DOCS_URL}/en/sdk/pipes-sdk/quickstart`} target="_blank">
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
