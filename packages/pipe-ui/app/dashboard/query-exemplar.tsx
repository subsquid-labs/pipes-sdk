import { useMemo } from 'react'
import { useStats } from '~/api/metrics'
import { Code } from '~/components/ui/code'

export function QueryExemplar() {
  const { data } = useStats()

  const query = useMemo(() => {
    if (!data?.portal.query) return ''

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
  }, [data?.portal.query])

  return (
    <div className="text-sm">
      <div className="mb-1">URL</div>
      <Code language="json">{data?.portal.url}</Code>

      <div className="mb-1 mt-2">Body</div>
      {query ? (
        <Code language="json" className="text-xxs max-h-[400px] overflow-auto px-1">
          {query}
        </Code>
      ) : (
        <div>No data</div>
      )}
    </div>
  )
}
