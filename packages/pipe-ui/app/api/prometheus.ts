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

export function useMetrics() {
  const url = 'http://127.0.0.1:9090/stats'

  return useQuery({
    queryKey: ['metrics'],
    queryFn: async () => {
      try {
        const res = await client<Stats>(url, {
          withCredentials: true,
        })

        history.push({
          bytesPerSecond: res.data.speed.bytesPerSecond,
          blocksPerSecond: res.data.speed.blocksPerSecond,
          memory: res.data.usage.memory,
        })

        history = history.slice(-MAX_HISTORY)

        return {
          ...res.data,
          history,
        }
      } catch (error) {
        return null
      }
    },

    refetchInterval: 1000,
  })
}
