import { useQuery, useQueryClient } from '@tanstack/react-query'

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
  code?: {
    filename: string
  }
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

type StatsResult = Omit<ApiStats, 'pipes'> & {
  status: ApiStatus
  pipes: Pipe[]
}

export function useStats(serverIndex: number) {
  const queryClient = useQueryClient()
  const serverKey = `server-${serverIndex}`

  return useQuery({
    queryKey: ['pipe/stats', serverIndex],
    queryFn: async (): Promise<StatsResult> => {
      try {
        const res = await fetch(`/api/metrics/stats?_server=${serverIndex}`)

        if (!res.ok) throw new Error('Failed to fetch stats')

        const data: HttpResponse<ApiStats> = await res.json()

        return {
          ...data.payload,
          status: ApiStatus.Connected,
          pipes: data.payload.pipes.map((pipe): Pipe => {
            let history = getHistory(serverKey, pipe.id)

            history.push({
              bytesPerSecond: pipe.speed.bytesPerSecond,
              blocksPerSecond: pipe.speed.blocksPerSecond,
              memory: data.payload.usage.memory,
            })

            history = history.slice(-MAX_HISTORY)

            let serverHistories = histories.get(serverKey)
            if (!serverHistories) {
              serverHistories = new Map()
              histories.set(serverKey, serverHistories)
            }
            serverHistories.set(pipe.id, history)

            let status = PipeStatus.Syncing
            if (pipe.progress.percent === 0) {
              status = PipeStatus.Calculating
            } else if (pipe.progress.etaSeconds < 1) {
              status = PipeStatus.Synced
            }

            return {
              ...pipe,
              status,
              history,
            }
          }),
        }
      } catch {
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

export function usePipe(serverIndex: number, id: string) {
  const { data: stats } = useStats(serverIndex)

  const data = stats?.pipes.find((pipe) => pipe.id === id)

  return data
}

export type ApiProfilerResult = {
  name: string
  totalTime: number
  children: ApiProfilerResult[]
}

export function useProfilers({ enabled = true, serverIndex, pipeId }: { enabled?: boolean; serverIndex: number; pipeId: string }) {
  return useQuery({
    queryKey: ['pipe/profiler', serverIndex, pipeId],
    queryFn: async () => {
      const res = await fetch(`/api/metrics/profiler?id=${pipeId}&_server=${serverIndex}`)

      if (!res.ok) throw new Error('Failed to fetch profiler')

      const data: HttpResponse<{
        enabled: boolean
        profilers: ApiProfilerResult[]
      }> = await res.json()

      return data.payload
    },
    enabled,
    retry: false,
    refetchInterval: 2000,
  })
}

export type ApiExemplarResult = {
  name: string
  data: any
  children: ApiExemplarResult[]
}

export function useTransformationExemplar({ enabled = true, serverIndex, pipeId }: { enabled?: boolean; serverIndex: number; pipeId: string }) {
  return useQuery({
    queryKey: ['pipe/exemplars/transformation', serverIndex, pipeId],
    queryFn: async () => {
      const res = await fetch(`/api/metrics/exemplars/transformation?id=${pipeId}&_server=${serverIndex}`)

      if (!res.ok) throw new Error('Failed to fetch transformation exemplar')

      const data: HttpResponse<{
        transformation: ApiExemplarResult
      }> = await res.json()

      return data.payload
    },
    enabled,
    retry: false,
    refetchInterval: 1500,
  })
}
