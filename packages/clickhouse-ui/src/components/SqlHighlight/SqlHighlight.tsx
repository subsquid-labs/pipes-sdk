import { useMemo } from 'react'
import { highlight } from './highlight'

export function SqlHighlight({ sql, className }: { sql: string; className?: string }) {
  const html = useMemo(() => {
    return highlight(sql, { html: true })
  }, [sql])

  return (
    <pre className={className}>
      <code className="whitespace-break-spaces" dangerouslySetInnerHTML={{ __html: html }} />
    </pre>
  )
}
