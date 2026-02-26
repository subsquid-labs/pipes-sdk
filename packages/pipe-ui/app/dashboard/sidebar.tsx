'use client'

import { AlertCircle } from 'lucide-react'

import { displayEstimatedTime } from '~/dashboard/formatters'
import { ApiStatus, type Pipe, PipeStatus, useStats } from '~/hooks/use-metrics'
import { usePortalStatus } from '~/hooks/use-portal'
import { useServerIndex } from '~/hooks/use-server-context'

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

export function PortalStatus({ url }: { url?: string }) {
  const host = url ? new URL(url).origin : ''

  const { data } = usePortalStatus(host)
  if (!data) return

  return (
    <div>
      <div className="w-full">
        <div className="mb-2">
          <h1 className="text-md font-bold mb-2">Portal</h1>
          <div className="text-secondary-foreground text-xxs">{host}</div>
        </div>
        <div className="flex flex-col items-start text-xs gap-2">
          {data.portal_version && (
            <div className="flex items-center gap-2">
              <div className="text-muted-foreground w-[60px]">Version</div>
              <div className=" flex items-center gap-1">{data.portal_version}</div>
            </div>
          )}
          <div className="flex items-center gap-2">
            <div className="text-muted-foreground w-[60px]">Workers</div>
            <div className=" flex items-center gap-1">{data.workers.active_count}</div>
          </div>
        </div>
      </div>
    </div>
  )
}

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
            className={`px-2 py-2 text-xs rounded-md border transition-colors ${
              pipe.id === selectedPipeId
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-secondary/50 text-muted-foreground border-border hover:bg-secondary'
            }`}
          >
            <div className="flex items-center gap-2">
              <div className="flex flex-[0_32px] items-center justify-center">
                {pipe.status === PipeStatus.Disconnected ? (
                  <AlertCircle size={20} className="text-destructive opacity-75 shrink-0" />
                ) : (
                  <CircularProgress percent={pipe.progress.percent} />
                )}
              </div>
              <div className="text-left w-full">
                <div className="text-sm flex items-center gap-1.5 mb-1.5">
                  {pipe.dataset?.metadata?.logo_url && (
                    <img src={pipe.dataset.metadata.logo_url} alt="" className="w-4 h-4" />
                  )}
                  <span>{pipe.dataset?.metadata?.display_name || pipe.id}</span>
                </div>

                {pipe.status === PipeStatus.Calculating ? (
                  <div className="flex w-full font-thin justify-between text-xxs animate-pulse">Calculating...</div>
                ) : pipe.status === PipeStatus.Disconnected ? (
                  <div className="flex w-full font-thin justify-between text-xxs text-destructive">Disconnected</div>
                ) : (
                  <div
                    className={
                      'flex w-full font-thin justify-between text-xxs' +
                      (pipe.status === PipeStatus.Syncing ? ' animate-pulse' : '')
                    }
                  >
                    <div>{pipe.progress.percent.toFixed(2)}%</div>
                    <div>{displayEstimatedTime(pipe, { etaLabel: '≈' })}</div>
                  </div>
                )}
              </div>
            </div>
          </button>
        ))}
      </div>
      {description && <div className="my-2 font-thin text-muted-foreground text-[10px]">{description}</div>}
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
  const connected = data?.status === ApiStatus.Connected

  return (
    <div className="flex-[0_250px]">
      <div className="w-full mb-2">
        <h1 className="text-2xl font-normal mb-2">Pipes SDK</h1>
        <div className="w-full flex flex-col items-start text-xs gap-2">
          <div className="flex items-center gap-2">
            <div className="text-xs font-normal text-muted-foreground w-[60px]">Status</div>
            <div className="font-medium text-foreground flex items-center gap-1">
              <div className="flex items-center gap-2">
                {connected ? (
                  <div className="w-[8px] h-[8px] rounded-full bg-teal-400" />
                ) : (
                  <div className="w-[8px] h-[8px] rounded-full bg-gray-500" />
                )}
                <div>{connected ? 'Connected' : 'Disconnected'}</div>
              </div>
            </div>
          </div>

          {data ? (
            <div className="flex items-center gap-2">
              <div className="text-xs font-normal text-muted-foreground w-[60px]">Version</div>
              <div className=" flex items-center gap-1">{data.sdk.version}</div>
            </div>
          ) : null}
        </div>
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
