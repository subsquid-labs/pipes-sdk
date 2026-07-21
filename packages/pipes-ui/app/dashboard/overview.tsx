'use client'

import { AlertCircle } from 'lucide-react'
import Link from 'next/link'
// @ts-ignore
import { Sparklines, SparklinesLine } from 'react-sparklines'

import { CircularProgress } from '~/components/ui/circular-progress'
import { datasetLabel, displayEstimatedTime, formatBlock, humanBytes } from '~/dashboard/formatters'
import { type FleetServer, type Pipe, PipeStatus, useFleetStats } from '~/hooks/use-metrics'
import { useServers } from '~/hooks/use-servers'

const sparklineStyle = { fill: '#d0a9e2' }
const sparklineColor = 'rgb(170, 140, 235)'

export function Overview() {
  const { data: servers } = useServers()
  const { data: fleet, isLoading } = useFleetStats(servers)

  if (isLoading || !fleet) return <OverviewSkeleton />

  const syncingCount = fleet.flatMap((s) => s.pipes).filter((p) => p.status === PipeStatus.Syncing).length
  const offlineCount = fleet.filter((s) => !s.online).length

  return (
    <div>
      <div className="flex items-baseline justify-between mb-4">
        <h1 className="text-2xl font-normal">Pipes</h1>
        <div className="text-xs text-muted-foreground">
          {syncingCount} syncing
          {offlineCount > 0 ? ` · ${offlineCount} offline` : ''}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {fleet.map((server) =>
          server.online ? (
            server.pipes.map((pipe) => (
              <PipeCard key={`${server.serverIndex}-${pipe.id}`} server={server} pipe={pipe} />
            ))
          ) : (
            <OfflineServerCard key={`offline-${server.serverIndex}`} server={server} />
          ),
        )}
      </div>
    </div>
  )
}

function PipeCard({ server, pipe }: { server: FleetServer; pipe: Pipe }) {
  const dataset = datasetLabel(pipe)

  return (
    <Link
      href={pipeHref(server.serverIndex, pipe.id)}
      className="block rounded-xl border p-4 transition-colors hover:bg-white/[0.03] hover:border-foreground/20"
    >
      <div className="flex items-center gap-2">
        {pipe.dataset?.metadata?.logo_url && <img src={pipe.dataset.metadata.logo_url} alt="" className="w-4 h-4" />}
        <span className="text-sm flex-1 truncate">{pipe.id}</span>
        {pipe.status === PipeStatus.Syncing && <CircularProgress percent={pipe.progress.percent} />}
      </div>
      <div className="text-xxs text-muted-foreground truncate mt-0.5 mb-3">
        {server.name || server.url}
        {dataset ? ` · ${dataset}` : ''}
      </div>

      {pipe.status === PipeStatus.Calculating ? (
        <div className="text-[10px] font-thin animate-pulse my-4">Calculating...</div>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <div className="flex-1 h-2 overflow-hidden rounded-full bg-gradient-primary">
              <div
                style={{ width: pipe.progress.percent.toFixed(0) + '%' }}
                className="h-full gradient-primary rounded-full"
              />
            </div>
            <div className="text-xxs text-muted-foreground tabular-nums">{pipe.progress.percent.toFixed(2)}%</div>
          </div>
          <div
            className={
              'flex justify-between mt-1.5 mb-3 text-xxs text-muted-foreground' +
              (pipe.status === PipeStatus.Syncing ? ' animate-pulse' : '')
            }
          >
            <div className="tabular-nums">
              {formatBlock(pipe.progress.current)} / {formatBlock(pipe.progress.to)}
            </div>
            <div>{displayEstimatedTime(pipe, { etaLabel: '≈' })}</div>
          </div>
        </>
      )}

      <div className="grid grid-cols-3 gap-2">
        <CardStat
          label="Indexing"
          value={`${pipe.speed.blocksPerSecond.toFixed(pipe.speed.blocksPerSecond > 1 ? 0 : 2)} bl/s`}
          data={pipe.history.map((v) => v.blocksPerSecond)}
        />
        <CardStat
          label="Download"
          value={`${humanBytes(pipe.speed.bytesPerSecond)}/s`}
          data={pipe.history.map((v) => v.bytesPerSecond)}
        />
        <CardStat label="Process memory" value={humanBytes(server.memory)} data={pipe.history.map((v) => v.memory)} />
      </div>
    </Link>
  )
}

function CardStat({ label, value, data }: { label: string; value: string; data: number[] }) {
  return (
    <div>
      <div className="rounded-sm overflow-hidden border bg-primary/2 pt-1">
        <Sparklines min={0} data={data} width={100} height={28} margin={0}>
          <SparklinesLine style={sparklineStyle} color={sparklineColor} />
        </Sparklines>
      </div>
      <div className="mt-1 text-[10px] font-normal text-muted-foreground truncate">{label}</div>
      <div className="text-xxs font-medium text-foreground/80 tabular-nums">{value}</div>
    </div>
  )
}

function OfflineServerCard({ server }: { server: FleetServer }) {
  return (
    <div className="rounded-xl border border-dashed p-4 opacity-60">
      <div className="flex items-center gap-2">
        <span className="text-sm flex-1 truncate">{server.name || server.url}</span>
        <AlertCircle size={18} className="text-muted-foreground/60 shrink-0" />
      </div>
      {server.name && <div className="text-xxs text-muted-foreground truncate mt-0.5">{server.url}</div>}
      <div className="mt-3 text-[10px] font-thin text-muted-foreground">Offline</div>
    </div>
  )
}

function pipeHref(serverIndex: number, pipeId: string) {
  const params = new URLSearchParams()
  if (serverIndex !== 0) params.set('server', String(serverIndex))
  params.set('pipe', pipeId)

  return `/?${params.toString()}`
}

function OverviewSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="h-[190px] rounded-xl border bg-white/[0.015] animate-pulse" />
      ))}
    </div>
  )
}
