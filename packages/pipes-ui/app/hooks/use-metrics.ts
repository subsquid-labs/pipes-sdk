import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'

import type { Server } from '~/hooks/use-servers'

type HttpResponse<T> = {
  payload: T
}

type ApiDataset = {
  dataset: string
  aliases: string[]
  real_time: boolean
  start_block: number
  metadata?: {
    kind: string
    display_name?: string
    logo_url?: string
    type?: string
    evm?: {
      chain_id: number
    }
  }
}

type ApiPipe = {
  id: string
  dataset: ApiDataset | null

  portal: {
    url: string
    query: any
  }
  progress: {
    from: number
    current: number
    to: number
    percent: number
    etaSeconds: number
  }
  speed: {
    blocksPerSecond: number
    bytesPerSecond: number
  }
}

type PipeHistory = {
  blocksPerSecond: number
  bytesPerSecond: number
  memory: number
}

export enum ApiStatus {
  Connected = 'Connected',
  Disconnected = 'Disconnected',
}

export enum PipeStatus {
  Calculating = 'Calculating',
  Syncing = 'Syncing',
  Synced = 'Synced',
  Disconnected = 'Disconnected',
}

export type Pipe = ApiPipe & {
  status: PipeStatus
  history: PipeHistory[]
}

export type ApiStats = {
  sdk: {
    version: string
  }
  runtime?: {
    name: 'bun' | 'node' | 'deno' | 'unknown'
    version: string
  }
  /** Path of the process entrypoint. */
  entrypoint?: string
  usage: {
    memory: number
  }
  pipes: ApiPipe[]
}

const MAX_HISTORY = 30

const histories = new Map<string, Map<string, PipeHistory[]>>()

function getHistory(serverKey: string, pipeId: string) {
  let serverHistories = histories.get(serverKey)
  if (!serverHistories) {
    serverHistories = new Map()
    histories.set(serverKey, serverHistories)
  }

  let history = serverHistories.get(pipeId)
  if (!history) {
    history = new Array(MAX_HISTORY).fill({
      blocksPerSecond: 0,
      bytesPerSecond: 0,
      memory: 0,
    })
    serverHistories.set(pipeId, history)
  }
  return history
}

function pushHistory(serverKey: string, pipeId: string, sample: PipeHistory): PipeHistory[] {
  const history = [...getHistory(serverKey, pipeId), sample].slice(-MAX_HISTORY)
  histories.get(serverKey)?.set(pipeId, history)

  return history
}

function enrichPipe(serverKey: string, pipe: ApiPipe, memory: number): Pipe {
  const history = pushHistory(serverKey, pipe.id, {
    blocksPerSecond: pipe.speed.blocksPerSecond,
    bytesPerSecond: pipe.speed.bytesPerSecond,
    memory,
  })

  let status = PipeStatus.Syncing
  if (pipe.progress.percent === 0) {
    status = PipeStatus.Calculating
  } else if (pipe.progress.etaSeconds < 1) {
    status = PipeStatus.Synced
  }

  return { ...pipe, status, history }
}

type StatsResult = Omit<ApiStats, 'pipes'> & {
  status: ApiStatus
  pipes: Pipe[]
}

export function useStats(serverIndex: number) {
  const queryClient = useQueryClient()
  const serverKey = `server-${serverIndex}`

  return useQuery({
    queryKey: ['pipe/stats', serverIndex],
    queryFn: async ({ signal }): Promise<StatsResult> => {
      try {
        const res = await fetch(`/api/metrics/stats?_server=${serverIndex}`, { signal })

        if (!res.ok) throw new Error('Failed to fetch stats')

        const data: HttpResponse<ApiStats> = await res.json()
        signal.throwIfAborted()

        return {
          ...data.payload,
          status: ApiStatus.Connected,
          pipes: data.payload.pipes.map((pipe) => enrichPipe(serverKey, pipe, data.payload.usage.memory)),
        }
      } catch {
        signal.throwIfAborted()

        const prev = queryClient.getQueryData<StatsResult>(['pipe/stats', serverIndex])
        if (prev) {
          return {
            ...prev,
            status: ApiStatus.Disconnected,
            pipes: prev.pipes.map((pipe) => ({ ...pipe, status: PipeStatus.Disconnected })),
          }
        }
        return {
          status: ApiStatus.Disconnected,
          sdk: { version: '' },
          usage: { memory: 0 },
          pipes: [],
        }
      }
    },

    retry: false,
    refetchInterval: 1000,
  })
}

export type ServerStatus = {
  online: boolean
  progress?: number
  syncingCount: number
  pipeCount: number
  firstPipeId?: string
}

export function useServerStatuses(count: number) {
  return useQuery({
    queryKey: ['server-statuses', count],
    queryFn: async (): Promise<Map<number, ServerStatus>> => {
      const results = await Promise.allSettled(
        Array.from({ length: count }, async (_, i) => {
          const res = await fetch(`/api/metrics/stats?_server=${i}`, { signal: AbortSignal.timeout(3000) })
          if (!res.ok) throw new Error('not ok')
          const data: HttpResponse<ApiStats> = await res.json()
          return data.payload
        }),
      )
      const map = new Map<number, ServerStatus>()
      for (let i = 0; i < results.length; i++) {
        const r = results[i]
        if (r.status !== 'fulfilled') {
          map.set(i, { online: false, syncingCount: 0, pipeCount: 0 })
          continue
        }
        const pipes = r.value.pipes
        const syncing = pipes.filter((p) => p.progress.percent > 0 && p.progress.etaSeconds >= 1)
        const progress =
          syncing.length > 0 ? syncing.reduce((sum, p) => sum + p.progress.percent, 0) / syncing.length : undefined
        map.set(i, {
          online: true,
          progress,
          syncingCount: syncing.length,
          pipeCount: pipes.length,
          firstPipeId: pipes[0]?.id,
        })
      }
      return map
    },
    refetchInterval: 3000,
    retry: false,
  })
}

export type FleetServer = {
  serverIndex: number
  name?: string
  url: string
  online: boolean
  memory: number
  pipes: Pipe[]
}

export function useFleetStats(servers: Server[] | undefined) {
  const results = useQueries({
    queries: (servers ?? []).map((server, serverIndex) => ({
      queryKey: ['fleet/stats', serverIndex, server.url],
      queryFn: async ({ signal }): Promise<FleetServer> => {
        const base = { serverIndex, name: server.name, url: server.url }

        try {
          const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(3000)])
          const res = await fetch(`/api/metrics/stats?_server=${serverIndex}`, { signal: requestSignal })
          if (!res.ok) throw new Error('not ok')
          const data: HttpResponse<ApiStats> = await res.json()
          signal.throwIfAborted()

          return {
            ...base,
            online: true,
            memory: data.payload.usage.memory,
            pipes: data.payload.pipes.map((pipe) =>
              enrichPipe(`server-${serverIndex}`, pipe, data.payload.usage.memory),
            ),
          }
        } catch {
          signal.throwIfAborted()

          return { ...base, online: false, memory: 0, pipes: [] }
        }
      },
      refetchInterval: 2000,
      retry: false,
    })),
  })

  if (!servers) return { data: undefined, isLoading: true }
  if (servers.length === 0) return { data: [], isLoading: false }

  const data = results.flatMap((result) => (result.data ? [result.data] : []))

  return { data, isLoading: data.length === 0 }
}

export function usePipe(serverIndex: number, id: string) {
  const { data: stats } = useStats(serverIndex)

  const data = stats?.pipes.find((pipe) => pipe.id === id)

  return data
}

export type ApiProfilerResult = {
  name: string
  totalTime: number
  /** Start offset (ms) relative to the root span of the tree. Optional — absent from SDK < 1.0.0-alpha.7. */
  startOffset?: number
  labels?: string[]
  children: ApiProfilerResult[]
}

export function useProfiles({
  enabled = true,
  serverIndex,
  pipeId,
}: {
  enabled?: boolean
  serverIndex: number
  pipeId: string
}) {
  return useQuery({
    queryKey: ['pipe/profiler', serverIndex, pipeId],
    queryFn: async () => {
      const res = await fetch(`/api/metrics/profiler?id=${pipeId}&_server=${serverIndex}`)

      if (!res.ok) throw new Error('Failed to fetch profiler')

      const data: HttpResponse<{
        enabled: boolean
        profiles?: ApiProfilerResult[]
      }> = await res.json()

      return {
        enabled: data.payload.enabled,
        profiles: data.payload.profiles ?? [],
      }
    },
    enabled,
    retry: false,
    refetchInterval: 2000,
  })
}

export type ApiPreviewResult = {
  name: string
  data: any
  elapsed?: number
  /** Start offset (ms) relative to the root span of the tree. Optional — absent from SDK < 1.0.0-alpha.7. */
  startOffset?: number
  dataSize?: number
  labels?: string[]
  children: ApiPreviewResult[]
}

export function useTransformationPreview({
  enabled = true,
  serverIndex,
  pipeId,
}: {
  enabled?: boolean
  serverIndex: number
  pipeId: string
}) {
  return useQuery({
    queryKey: ['pipe/preview/transformation', serverIndex, pipeId],
    queryFn: async () => {
      const res = await fetch(`/api/metrics/preview/transformation?id=${pipeId}&_server=${serverIndex}`)

      if (!res.ok) throw new Error('Failed to fetch transformation preview')

      const data: HttpResponse<{
        transformation: ApiPreviewResult
        batch?: { from: number; to: number; blocksCount: number; bytesSize?: number }
      }> = await res.json()

      return data.payload
    },
    enabled,
    retry: false,
    refetchInterval: 1500,
  })
}
