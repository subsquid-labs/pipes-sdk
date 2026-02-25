import { useQuery, useQueryClient } from '@tanstack/react-query'

import { client, getUrl } from '~/api/client'

type HttpResponse<T> = {
  payload: T
}

type ApiPipe = {
  id: string

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

const histories = new Map<string, PipeHistory[]>()

function getHistory(pipeId: string) {
  let history = histories.get(pipeId)
  if (!history) {
    history = new Array(MAX_HISTORY).fill({
      blocksPerSecond: 0,
      bytesPerSecond: 0,
      memory: 0,
    })
    histories.set(pipeId, history)
  }
  return history
}

const BASE_URL = 'http://127.0.0.1:9090'

type StatsResult = Omit<ApiStats, 'pipes'> & {
  status: ApiStatus
  pipes: Pipe[]
}

export function useStats() {
  const url = getUrl(BASE_URL, `/stats`)
  const queryClient = useQueryClient()

  return useQuery({
    queryKey: ['pipe/stats'],
    queryFn: async (): Promise<StatsResult> => {
      try {
        const res = await client<HttpResponse<ApiStats>>(url)

        return {
          ...res.data.payload,
          status: ApiStatus.Connected,
          pipes: res.data.payload.pipes.map((pipe): Pipe => {
            let history = getHistory(pipe.id)

            history.push({
              bytesPerSecond: pipe.speed.bytesPerSecond,
              blocksPerSecond: pipe.speed.blocksPerSecond,
              memory: res.data.payload.usage.memory,
            })

            history = history.slice(-MAX_HISTORY)
            histories.set(pipe.id, history)

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
      } catch (error) {
        const prev = queryClient.getQueryData<StatsResult>(['pipe/stats'])
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

    // No retry — refetchInterval already handles re-polling, and retries would delay showing the disconnected state
    retry: false,
    refetchInterval: 1000,
  })
}

export function usePipe(id: string) {
  const { data: stats } = useStats()

  const data = stats?.pipes.find((pipe) => pipe.id === id)

  return data
}

export type ApiProfilerResult = {
  name: string
  totalTime: number
  children: ApiProfilerResult[]
}

export function useProfilers({ enabled = true, pipeId }: { enabled?: boolean; pipeId: string }) {
  const url = getUrl(BASE_URL, `/profiler?id=${pipeId}`)

  return useQuery({
    queryKey: ['pipe/profiler', pipeId],
    queryFn: async () => {
      const res = await client<
        HttpResponse<{
          enabled: boolean
          profilers: ApiProfilerResult[]
        }>
      >(url, {
        withCredentials: true,
      })

      return res.data.payload
    },
    enabled,
    // No retry — refetchInterval already handles re-polling, and retries would delay showing the disconnected state
    retry: false,
    refetchInterval: 2000,
  })
}

export type ApiExemplarResult = {
  name: string
  data: any
  children: ApiExemplarResult[]
}

export function useTransformationExemplar({ enabled = true, pipeId }: { enabled?: boolean; pipeId: string }) {
  const url = getUrl(BASE_URL, `/exemplars/transformation?id=${pipeId}`)

  return useQuery({
    queryKey: ['pipe/exemplars/transformation', pipeId],
    queryFn: async () => {
      const res = await client<
        HttpResponse<{
          transformation: ApiExemplarResult
        }>
      >(url, {
        withCredentials: true,
      })

      return res.data.payload
    },
    enabled,
    // No retry — refetchInterval already handles re-polling, and retries would delay showing the disconnected state
    retry: false,
    refetchInterval: 1500,
  })
}
