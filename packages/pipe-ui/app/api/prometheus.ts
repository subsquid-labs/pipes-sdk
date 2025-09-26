import { useQuery } from '@tanstack/react-query'
import { client } from '~/api/client'

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

export function useMetrics() {
  const url = 'http://127.0.0.1:9090/stats'

  return useQuery({
    queryKey: ['metrics'],
    queryFn: async () => {
      try {
        const res = await client<Stats>(url, {
          withCredentials: true,
        })
        return res.data
      } catch (error) {
        return null
      }
    },
    refetchInterval: 1000,
  })
}
