'use client'

import * as React from 'react'

import { SqlHighlight } from '~/components/SqlHighlight/SqlHighlight'

type Props = {
  sql: string
  truncateLen?: number
}

function truncateSql(sql: string, truncateLen: number) {
  if (truncateLen <= 0) return { text: sql, truncated: false }
  if (sql.length <= truncateLen) return { text: sql, truncated: false }
  return { text: `${sql.slice(0, truncateLen).trimEnd()}…`, truncated: true }
}

export function QueryPreview({ sql, truncateLen = 220 }: Props) {
  const [expanded, setExpanded] = React.useState(false)
  const trimmed = sql.trim()
  const { text, truncated } = truncateSql(trimmed, truncateLen)

  const shownSql = expanded || !truncated ? trimmed : text

  return (
    <button
      type="button"
      className="block w-full text-left"
      aria-expanded={expanded}
      onClick={() => setExpanded((v) => !v)}
    >
      <SqlHighlight sql={shownSql} className="block rounded-xl border bg-opacity-10 p-3" />
    </button>
  )
}
