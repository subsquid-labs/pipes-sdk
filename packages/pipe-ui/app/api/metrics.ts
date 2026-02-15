import { useQuery } from '@tanstack/react-query'

import { client, getUrl } from '~/api/client'

type HttpResponse<T> = {
  payload: T
}

export type Stats = {
  sdk: {
    version: string
  }
  usage: {
    memory: number
  }
  pipes: {
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
  }[]
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
      try {
        const res = await client<HttpResponse<Stats>>(url)

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
      } catch (error) {
        return null
      }
    },

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
  const url = getUrl(BASE_URL, `/profiler?pipe=${pipeId}`)

  return useQuery({
    queryKey: ['pipe/profiler', pipeId],
    queryFn: async () => {
      try {
        const res = await client<
          HttpResponse<{
            enabled: boolean
            profilers: ApiProfilerResult[]
          }>
        >(url, {
          withCredentials: true,
        })

        return res.data.payload
      } catch (error) {
        return null
      }
    },
    enabled,
    refetchInterval: 2000,
  })
}

export type ApiExemplarResult = {
  name: string
  data: any
  children: ApiExemplarResult[]
}

export function useTransformationExemplar({ enabled = true, pipeId }: { enabled?: boolean; pipeId: string }) {
  const url = getUrl(BASE_URL, `/exemplars/transformation?pipe=${pipeId}`)

  return useQuery({
    queryKey: ['pipe/exemplars/transformation', pipeId],
    queryFn: async () => {
      try {
        const res = await client<
          HttpResponse<{
            transformation: ApiExemplarResult
          }>
        >(url, {
          withCredentials: true,
        })

        return res.data.payload
      } catch (error) {
        return null
      }
    },
    enabled,
    refetchInterval: 1500,
  })
}
