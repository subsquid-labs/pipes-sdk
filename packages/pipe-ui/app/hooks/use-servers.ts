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
      if (!res.ok) throw new Error(`Failed to fetch servers: ${res.status}`)
      const data: ServersResponse = await res.json()

      return data.servers
    },
    staleTime: Infinity,
  })
}

export type { Server }
