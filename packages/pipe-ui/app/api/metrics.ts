import { useQuery } from '@tanstack/react-query'
import { client } from '~/api/client'

type HttpResponse<T> = {
  payload: T
}

export type Stats = {
  sdk: {
    version: string
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
  usage: {
    memory: number
  }
}

const MAX_HISTORY = 30
let history: {
  blocksPerSecond: number
  bytesPerSecond: number
  memory: number
}[] = new Array(MAX_HISTORY).fill({
  blocksPerSecond: 0,
  bytesPerSecond: 0,
  memory: 0,
})

function getUrl(host: string, path: string) {
  return `${host}${path.startsWith('/') ? path : `/${path}`}`
}

export function useMetrics() {
  const url = getUrl('http://127.0.0.1:9090', '/stats')

  return useQuery({
    queryKey: ['stats'],
    queryFn: async () => {
      try {
        const res = await client<HttpResponse<Stats>>(url, {
          withCredentials: true,
        })

        history.push({
          bytesPerSecond: res.data.payload.speed.bytesPerSecond,
          blocksPerSecond: res.data.payload.speed.blocksPerSecond,
          memory: res.data.payload.usage.memory,
        })

        history = history.slice(-MAX_HISTORY)

        return {
          ...res.data.payload,
          history,
        }
      } catch (error) {
        return null
      }
    },

    refetchInterval: 1000,
  })
}

export type ApiProfilerResult = {
  name: string
  totalTime: number
  children: ApiProfilerResult[]
}

export function useProfilers() {
  const url = getUrl('http://127.0.0.1:9090', '/profiler')

  return useQuery({
    queryKey: ['profiler'],
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

    refetchInterval: 1000,
  })
}

export type ApiExemplarResult = {
  name: string
  data: any
  children: ApiExemplarResult[]
}

export function useTransformationExemplar() {
  const url = getUrl('http://127.0.0.1:9090', '/exemplars/transformation')

  return useQuery({
    queryKey: ['/exemplars/transformation'],
    queryFn: async () => {
      try {
        const res = await client<
          HttpResponse<{
            exemplar: ApiExemplarResult
          }>
        >(url, {
          withCredentials: true,
        })

        return res.data.payload
      } catch (error) {
        return null
      }
    },

    refetchInterval: 1000,
  })
}
