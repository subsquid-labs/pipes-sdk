'use client'

import { AlertCircle, ChevronsUpDown } from 'lucide-react'

import { Select, SelectContent, SelectItem, SelectTrigger } from '~/components/ui/select'
import { displayEstimatedTime } from '~/dashboard/formatters'
import { type ApiStats, ApiStatus, type Pipe, PipeStatus, useStats } from '~/hooks/use-metrics'
import { useServerIndex } from '~/hooks/use-server-context'
import { type Server, useServers } from '~/hooks/use-servers'

function CircularProgress({ percent }: { percent: number }) {
  const r = 6
  const circumference = 2 * Math.PI * r
  const offset = circumference - (percent / 100) * circumference

  return (
    <svg width="26" height="26" viewBox="0 0 16 16">
      <defs>
        <linearGradient id="progress-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#433485" />
          <stop offset="50%" stopColor="#b53cdd" />
          <stop offset="100%" stopColor="#d0a9e2" />
        </linearGradient>
      </defs>
      <circle cx="8" cy="8" r={r} fill="none" stroke="currentColor" strokeWidth="2" opacity={0.1} />
      <circle
        cx="8"
        cy="8"
        r={r}
        fill="none"
        stroke="url(#progress-gradient)"
        strokeWidth="2"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform="rotate(-90 8 8)"
        className="transition-all duration-300"
      />
    </svg>
  )
}

// export function PortalStatus({ url }: { url?: string }) {
//   const host = url ? new URL(url).origin : ''
//
//   const { data } = usePortalStatus(host)
//   if (!data) return
//
//   return (
//     <div>
//       <div className="w-full">
//         <div className="mb-2">
//           <h1 className="text-md font-bold mb-2">Portal</h1>
//           <div className="text-secondary-foreground text-xxs">{host}</div>
//         </div>
//         <div className="flex flex-col items-start text-xs gap-2">
//           <div className={`flex items-center gap-2 ${data.portal_version ? 'hidden' : ''}`}>
//             <div className="text-muted-foreground w-[60px]">Version</div>
//             <div className=" flex items-center gap-1">{data.portal_version}</div>
//           </div>
//           <div className="flex items-center gap-2">
//             <div className="text-muted-foreground w-[60px]">Workers</div>
//             <div className=" flex items-center gap-1">{data.workers.active_count}</div>
//           </div>
//         </div>
//       </div>
//     </div>
//   )
// }

function PipeSelector({
  description,
  pipes,
  selectedPipeId,
  onSelectPipe,
}: {
  description?: string
  pipes: Pipe[]
  selectedPipeId?: string
  onSelectPipe: (id: string) => void
}) {
  if (!pipes.length) return null

  return (
    <div>
      <div className="text-xs font-normal text-muted-foreground mb-1">Pipes</div>

      <div className="flex flex-col gap-1">
        {pipes.map((pipe) => (
          <button
            key={pipe.id}
            onClick={() => onSelectPipe(pipe.id)}
            className={`px-2 py-1.5 text-xs rounded-md border transition-colors text-xxs ${
              pipe.id === selectedPipeId
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-secondary/50 text-muted-foreground border-border hover:bg-secondary'
            }`}
          >
            <div className="flex items-center gap-1.5 mb-1.5">
              {pipe.dataset?.metadata?.logo_url && (
                <img src={pipe.dataset.metadata.logo_url} alt="" className="w-4 h-4" />
              )}
              <span className="text-sm flex-1 text-left">{pipe.id}</span>
              {/*<span className="text-muted-foreground text-xxs">{pipe.dataset?.metadata?.display_name}</span>*/}

              {pipe.status === PipeStatus.Disconnected ? (
                <AlertCircle size={20} className="text-destructive opacity-75 shrink-0" />
              ) : pipe.status === PipeStatus.Syncing ? (
                <CircularProgress percent={pipe.progress.percent} />
              ) : null}
            </div>

            {pipe.status === PipeStatus.Calculating ? (
              <div className="flex w-full font-thin justify-between animate-pulse">Calculating...</div>
            ) : pipe.status === PipeStatus.Disconnected ? (
              <div className="flex w-full font-thin justify-between text-destructive">Disconnected</div>
            ) : (
              <div
                className={
                  'flex w-full font-thin justify-between' + (pipe.status === PipeStatus.Syncing ? ' animate-pulse' : '')
                }
              >
                <div>{pipe.progress.percent.toFixed(2)}%</div>
                <div>{displayEstimatedTime(pipe, { etaLabel: '≈' })}</div>
              </div>
            )}
          </button>
        ))}
      </div>
      {description && <div className="my-2 font-thin text-muted-foreground text-[10px]">{description}</div>}
    </div>
  )
}

function StatusDot({ connected }: { connected: boolean }) {
  return (
    <span className="relative inline-flex shrink-0 items-center justify-center">
      {connected && (
        <span className="absolute inline-flex h-2 w-2 animate-ping rounded-full bg-teal-400 opacity-60" />
      )}
      <span
        className={`relative inline-flex h-[7px] w-[7px] rounded-full ${
          connected ? 'bg-teal-400 shadow-[0_0_6px_0_rgba(45,212,191,0.8)]' : 'bg-gray-500'
        }`}
      />
    </span>
  )
}

function ServerSelect({ servers, connected }: { servers: Server[]; connected: boolean }) {
  const { serverIndex, setServerIndex } = useServerIndex()
  const current = servers[serverIndex] ?? servers[0]
  const label = current?.name || current?.url || 'Select server'

  return (
    <div>
      <div className="text-xs font-normal text-muted-foreground mb-1.5">Server</div>
      <Select value={String(serverIndex)} onValueChange={(v: string) => setServerIndex(Number(v))}>
        <SelectTrigger
          className={`group relative w-full h-auto py-2 px-2.5 text-sm rounded-lg border bg-gradient-to-b from-white/[0.04] to-white/[0.01] hover:from-white/[0.06] hover:to-white/[0.02] transition-all ${
            connected ? 'border-teal-400/20 hover:border-teal-400/40' : 'border-border hover:border-border/80'
          }`}
        >
          <div className="flex items-center gap-2.5 w-full min-w-0">
            <StatusDot connected={connected} />
            <div className="flex flex-col items-start min-w-0 flex-1">
              <span className="text-xs text-foreground truncate w-full text-left font-normal">{label}</span>
              <span
                className={`text-[10px] leading-tight ${
                  connected ? 'text-teal-400/80' : 'text-muted-foreground'
                }`}
              >
                {connected ? 'Connected' : 'Disconnected'}
              </span>
            </div>
            <ChevronsUpDown className="size-3.5 opacity-50 group-hover:opacity-80 transition-opacity shrink-0" />
          </div>
        </SelectTrigger>
        <SelectContent className="min-w-[var(--radix-select-trigger-width)]">
          {servers.map((server, index) => (
            <SelectItem key={server.url} value={String(index)} className="text-xs py-2">
              <div className="flex flex-col items-start gap-0.5 min-w-0">
                <span className="truncate">{server.name || server.url}</span>
                {server.name && (
                  <span className="text-[10px] text-muted-foreground truncate">{server.url}</span>
                )}
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function RuntimeInfo({
  runtime,
  sdkVersion,
}: {
  runtime?: ApiStats['runtime']
  sdkVersion?: string
}) {
  if (!runtime && !sdkVersion) return null

  const runtimeLabel = runtime?.name === 'bun' ? 'Bun' : runtime?.name === 'deno' ? 'Deno' : 'Node'

  return (
    <div className="mt-3 rounded-lg border border-border/60 bg-white/[0.015] px-2.5 py-2">
      <div className="flex flex-col gap-1.5 text-[10px]">
        {runtime?.version && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">{runtimeLabel}</span>
            <span className="font-mono text-foreground/90">v{runtime.version}</span>
          </div>
        )}
        {sdkVersion && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">SDK</span>
            <span className="font-mono text-foreground/90">v{sdkVersion}</span>
          </div>
        )}
      </div>
    </div>
  )
}

export function Sidebar({
  pipes,
  selectedPipeId,
  onSelectPipe,
}: {
  pipes: Pipe[]
  selectedPipeId?: string
  onSelectPipe: (id: string) => void
}) {
  const { serverIndex } = useServerIndex()
  const { data } = useStats(serverIndex)
  const { data: servers } = useServers()
  const connected = data?.status === ApiStatus.Connected

  return (
    <div className="flex-[0_220px]">
      <div className="w-full mb-2">
        <h1 className="text-2xl font-normal mb-2">Pipes SDK</h1>

        {servers && (
          <div className="mt-2 mb-3">
            <ServerSelect servers={servers} connected={connected} />
            <RuntimeInfo runtime={data?.runtime} sdkVersion={data?.sdk?.version} />
          </div>
        )}
      </div>
      {/*<PortalStatus url={data?.pipes[0]?.portal.url} />*/}

      <div className="mt-2">
        <PipeSelector pipes={pipes} selectedPipeId={selectedPipeId} onSelectPipe={onSelectPipe} />
      </div>
      {data?.code?.filename && (
        <div className="my-2">
          <div className="text-xs font-normal text-muted-foreground mb-0.5">Entry point</div>
          <div className="text-foreground text-xs">{data?.code?.filename}</div>
        </div>
      )}
    </div>
  )
}
