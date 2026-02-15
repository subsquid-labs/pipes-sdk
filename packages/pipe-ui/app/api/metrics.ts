import { useQuery } from '@tanstack/react-query'

import { client, getUrl } from '~/api/client'

type HttpResponse<T> = {
  payload: T
}

export type ApiPipe = {
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
export const DEFAULT_PIPE_ID = 'stream'
const histories = new Map<
  string,
  {
    blocksPerSecond: number
    bytesPerSecond: number
    memory: number
  }[]
>()

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

export function useStats() {
  const url = getUrl(BASE_URL, `/stats`)

  return useQuery({
    queryKey: ['pipe/stats'],
    queryFn: async () => {
      const res = await client<HttpResponse<ApiStats>>(url)

      return {
        ...res.data.payload,
        pipes: res.data.payload.pipes.map((pipe) => {
          let history = getHistory(pipe.id)

          history.push({
            bytesPerSecond: pipe.speed.bytesPerSecond,
            blocksPerSecond: pipe.speed.blocksPerSecond,
            memory: res.data.payload.usage.memory,
          })

          history = history.slice(-MAX_HISTORY)
          histories.set(pipe.id, history)

          return { ...pipe, history }
        }),
      }
    },
    // No retry — refetchInterval already handles re-polling, and retries would delay showing the disconnected state
    retry: false,
    placeholderData: (prev) => prev,
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
