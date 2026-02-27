'use client'

import type { Server } from '~/hooks/use-servers'

export function ServerSelector({
  servers,
  serverIndex,
  onSelect,
}: {
  servers: Server[]
  serverIndex: number
  onSelect: (index: number) => void
}) {
  return (
    <div className="flex items-center gap-1.5">
      {servers.map((server, index) => (
        <button
          key={server.url}
          onClick={() => onSelect(index)}
          className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${
            index === serverIndex
              ? 'bg-primary text-primary-foreground border-primary'
              : 'bg-secondary/50 text-muted-foreground border-border hover:bg-secondary'
          }`}
          title={server.url}
        >
          {formatServerLabel(server.url, index)}
        </button>
      ))}
    </div>
  )
}

function formatServerLabel(url: string, index: number): string {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'
      ? 'localhost'
      : parsed.hostname
    return `${host}:${parsed.port || '80'}`
  } catch {
    return `Server ${index + 1}`
  }
}
