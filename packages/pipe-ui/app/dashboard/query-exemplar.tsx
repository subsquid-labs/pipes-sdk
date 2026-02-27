'use client'

import { useMemo, useState } from 'react'

import { Code } from '~/components/ui/code'
import { usePipe } from '~/hooks/use-metrics'
import { useServerIndex } from '~/hooks/use-server-context'

type QueryView = 'json' | 'curl'

export function QueryExemplar({ pipeId }: { pipeId: string }) {
  const { serverIndex } = useServerIndex()
  const data = usePipe(serverIndex, pipeId)
  const [view, setView] = useState<QueryView>('json')

  if (!data) return <div>No data</div>

  const query = useMemo(() => {
    if (!data.portal.query) return ''

    const { type, fromBlock, toBlock, fields, ...rest } = data.portal.query

    // Preserve the order of type, fromBlock, toBlock, and then rest of the properties
    return JSON.stringify(
      {
        type,
        fromBlock,
        toBlock,
        fields,
        ...rest,
      },
      null,
      2,
    )
  }, [data.portal.query])

  const curl = `curl -X POST ${data.portal.url}/stream -H "Content-Type: application/json" -d '${query}'`

  return (
    <div className="text-sm">
      <div className="mb-1">URL</div>
      <Code language="json">{data?.portal.url}</Code>

      <div className="flex items-center gap-2 mb-1 mt-2">
        <button
          className={`text-xs px-2 py-0.5 rounded-md transition-colors ${view === 'json' ? 'bg-primary/20 text-secondary-foreground' : 'text-muted-foreground hover:bg-primary/10'}`}
          onClick={() => setView('json')}
        >
          JSON
        </button>
        <button
          className={`text-xs px-2 py-0.5 rounded-md transition-colors ${view === 'curl' ? 'bg-primary/20 text-secondary-foreground' : 'text-muted-foreground hover:bg-primary/10'}`}
          onClick={() => setView('curl')}
        >
          cURL
        </button>
      </div>

      {view === 'json' ? (
        query ? (
          <Code language="json" className="text-xxs max-h-[400px] overflow-auto px-1">
            {query}
          </Code>
        ) : (
          <div>No data</div>
        )
      ) : (
        <Code language="bash" className="text-xxs max-h-[400px] overflow-auto px-1">
          {curl}
        </Code>
      )}
    </div>
  )
}
