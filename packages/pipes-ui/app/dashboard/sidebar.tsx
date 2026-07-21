'use client'

import { useEffect, useRef, useState } from 'react'

import { AlertCircle, ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react'

import { CircularProgress } from '~/components/ui/circular-progress'
import { displayEstimatedTime } from '~/dashboard/formatters'
import {
  type ApiStats,
  ApiStatus,
  type Pipe,
  PipeStatus,
  type ServerStatus,
  useServerStatuses,
  useStats,
} from '~/hooks/use-metrics'
import { useServerIndex } from '~/hooks/use-server-context'
import { type Server, useServers } from '~/hooks/use-servers'
import { useUrlNavigate } from '~/hooks/use-url-param'

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
      <div className="text-xs font-normal text-muted-foreground mb-1.5">Pipes</div>

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
            <div className="flex items-center gap-2 mb-0.5">
              {pipe.dataset?.metadata?.logo_url && (
                <img src={pipe.dataset.metadata.logo_url} alt="" className="w-4 h-4" />
              )}
              <span className="text-sm flex-1 text-left">{pipe.id}</span>
              {/*<span className="text-muted-foreground text-xxs">{pipe.dataset?.metadata?.display_name}</span>*/}

              {pipe.status === PipeStatus.Disconnected ? (
                <div className="flex items-center h-[26px] w-[20px]">
                  <AlertCircle size={18} className="text-muted-foreground/60 shrink-0" />
                </div>
              ) : pipe.status === PipeStatus.Syncing ? (
                <CircularProgress percent={pipe.progress.percent} />
              ) : null}
            </div>

            {pipe.status === PipeStatus.Calculating ? (
              <div className="flex w-full text-[10px] font-thin justify-between animate-pulse">Calculating...</div>
            ) : pipe.status === PipeStatus.Disconnected ? (
              <div className="flex w-full text-[10px] font-thin justify-between text-muted-foreground">Offline</div>
            ) : (
              <div
                className={
                  'flex w-full text-[10px] font-thin justify-between' +
                  (pipe.status === PipeStatus.Syncing ? ' animate-pulse' : '')
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
    <span
      className={`inline-flex shrink-0 h-[6px] w-[6px] rounded-full ${
        connected ? 'bg-emerald-400 shadow-[0_0_4px_0_rgba(52,211,153,0.6)]' : 'bg-gray-500/60'
      }`}
    />
  )
}

function ServerSelect({
  servers,
  connected,
  statuses,
}: {
  servers: Server[]
  connected: boolean
  statuses?: Map<number, ServerStatus>
}) {
  const { serverIndex } = useServerIndex()
  const navigate = useUrlNavigate()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const current = servers[serverIndex] ?? servers[0]
  const label = current?.name || current?.url || 'Select server'

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="group w-full px-2.5 py-2.5 text-left rounded-lg border border-border bg-white/[0.015] hover:bg-white/[0.03] transition-colors"
      >
        <div className="flex items-center gap-2.5 w-full min-w-0">
          <StatusDot connected={connected} />
          <div className="flex flex-col items-start min-w-0 flex-1 gap-0.5">
            <span className="text-xs text-foreground w-full font-normal break-words">{label}</span>
            {current?.name && current?.url && (
              <span className="text-[10px] leading-tight text-muted-foreground w-full break-all">{current.url}</span>
            )}
          </div>
          <ChevronsUpDown className="size-3 opacity-40 group-hover:opacity-70 transition-opacity shrink-0" />
        </div>
      </button>

      {open && (
        <div className="absolute z-50 mt-0.5 w-full rounded-lg border border-border bg-gray-950 overflow-hidden shadow-2xl shadow-black/50">
          <ScrollableList>
            {servers.map((server, index) => {
              const isSelected = index === serverIndex
              const status = statuses?.get(index)
              const online = status?.online
              return (
                <button
                  key={server.url}
                  type="button"
                  onClick={() => {
                    setOpen(false)
                    if (isSelected) return

                    // Land on the target server's first pipe when we know it (statuses
                    // refresh every 3s); when the server is offline/unknown, keep the pipe
                    // param — the detail view then accurately shows the disconnected panel.
                    const firstPipeId = statuses?.get(index)?.firstPipeId
                    navigate({
                      server: index === 0 ? null : index,
                      ...(firstPipeId ? { pipe: firstPipeId } : {}),
                    })
                  }}
                  className={`relative flex items-center gap-2.5 w-full rounded-md px-2.5 py-2 text-left text-foreground transition-colors ${
                    isSelected ? 'bg-[#433485]/30' : 'hover:bg-[#433485]/20'
                  }`}
                >
                  <div
                    className={`flex flex-col items-start gap-0.5 min-w-0 flex-1 ${online === false ? 'opacity-40' : ''}`}
                  >
                    <span className="text-xs w-full font-normal break-words">{server.name || server.url}</span>
                    {server.name && (
                      <span className="text-[10px] text-muted-foreground w-full break-all">{server.url}</span>
                    )}
                  </div>
                  {online === false ? (
                    <span className="inline-flex items-center gap-1.5 shrink-0 text-[10px] text-muted-foreground">
                      Offline
                      <AlertCircle className="size-3" />
                    </span>
                  ) : status?.progress !== undefined ? (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-[10px] font-thin tabular-nums text-muted-foreground">
                        {status.progress.toFixed(0)}%
                      </span>
                      <CircularProgress percent={status.progress} />
                    </div>
                  ) : null}
                </button>
              )
            })}
          </ScrollableList>
        </div>
      )}
    </div>
  )
}

function ScrollableList({ children, maxHeight = 320 }: { children: React.ReactNode; maxHeight?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [canUp, setCanUp] = useState(false)
  const [canDown, setCanDown] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => {
      setCanUp(el.scrollTop > 0)
      setCanDown(el.scrollTop + el.clientHeight < el.scrollHeight - 1)
    }
    update()
    el.addEventListener('scroll', update)
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', update)
      ro.disconnect()
    }
  }, [])

  const scrollBy = (dir: 1 | -1) => {
    ref.current?.scrollBy({ top: dir * 80, behavior: 'smooth' })
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => scrollBy(-1)}
        aria-hidden={!canUp}
        tabIndex={canUp ? 0 : -1}
        className={`absolute top-0 left-0 right-0 z-10 flex items-center justify-center py-2 cursor-pointer bg-gradient-to-b from-background via-background/90 to-transparent text-muted-foreground hover:text-foreground transition-opacity duration-200 ${
          canUp ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        <ChevronUp className="size-3.5" />
      </button>
      <div
        ref={ref}
        className="p-1 flex flex-col gap-0.5 overflow-y-auto"
        style={{
          maxHeight,
          scrollPaddingTop: canUp ? 28 : undefined,
          scrollPaddingBottom: canDown ? 28 : undefined,
        }}
      >
        {children}
      </div>
      <button
        type="button"
        onClick={() => scrollBy(1)}
        aria-hidden={!canDown}
        tabIndex={canDown ? 0 : -1}
        className={`absolute bottom-0 left-0 right-0 z-10 flex items-center justify-center py-2 cursor-pointer bg-gradient-to-t from-background via-background/90 to-transparent text-muted-foreground hover:text-foreground transition-opacity duration-200 ${
          canDown ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        <ChevronDown className="size-3.5" />
      </button>
    </div>
  )
}

function RuntimeInfo({
  runtime,
  sdkVersion,
  entryPoint,
}: {
  runtime?: ApiStats['runtime']
  sdkVersion?: string
  entryPoint?: string
}) {
  if (!runtime && !sdkVersion && !entryPoint) return null

  const runtimeLabels: Record<string, string> = {
    bun: 'Bun',
    deno: 'Deno',
    node: 'Node',
    unknown: 'Unknown',
  }
  const runtimeLabel = runtime?.name ? (runtimeLabels[runtime.name] ?? 'Unknown') : 'Unknown'

  return (
    <div>
      <div className="text-xs font-normal text-muted-foreground mb-1">Runtime</div>
      <div className="rounded-lg border border-border bg-white/[0.015] px-2.5 py-2 flex flex-col gap-1.5 text-[10px]">
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
        {entryPoint && (
          <div className="flex flex-col gap-0.5">
            <span className="text-muted-foreground">Entry point</span>
            <span className="text-foreground/90 break-all">{entryPoint}</span>
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
  const { data: statuses } = useServerStatuses(servers?.length ?? 0)
  const connected = data?.status === ApiStatus.Connected

  return (
    <div className="w-[250px] shrink-0 flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-normal mb-2">Pipes SDK</h1>
        {servers && <ServerSelect servers={servers} connected={connected} statuses={statuses} />}
      </div>

      <PipeSelector pipes={pipes} selectedPipeId={selectedPipeId} onSelectPipe={onSelectPipe} />
      <RuntimeInfo runtime={data?.runtime} sdkVersion={data?.sdk?.version} entryPoint={data?.entrypoint} />
    </div>
  )
}
