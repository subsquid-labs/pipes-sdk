import { useQuery } from '@tanstack/react-query'

type Server = {
  url: string
  name?: string
}

type ServersResponse = {
  servers: Server[]
}

export function useServers() {
  return useQuery({
    queryKey: ['servers'],
    queryFn: async (): Promise<Server[]> => {
      const res = await fetch('/api/servers')
      const data: ServersResponse = await res.json()

      return data.servers
    },
    staleTime: Infinity,
  })
}

export type { Server }
