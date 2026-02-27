import { useQuery } from '@tanstack/react-query'

type ApiPortalStatus = {
  peer_id: string
  status: 'registered'
  operator: string
  current_epoch: {
    number: number
    started_at: string
    ended_at: string
    duration_seconds: number
  }
  sqd_locked: string
  cu_per_epoch: string
  workers: {
    active_count: number
    rate_limit_per_worker: string
  }
  portal_version: string
}

export function usePortalStatus(host?: string) {
  return useQuery({
    enabled: !!host,
    queryKey: ['portal/status', host],
    queryFn: async () => {
      try {
        const res = await fetch(`/api/portal?host=${encodeURIComponent(host!)}`)

        if (!res.ok) return null

        const data: ApiPortalStatus = await res.json()
        return data
      } catch {
        return null
      }
    },
  })
}
