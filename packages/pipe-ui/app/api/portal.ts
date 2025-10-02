import { useQuery } from '@tanstack/react-query'
import { client, getUrl } from '~/api/client'

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
  const url = getUrl(host || '', '/status')

  return useQuery({
    enabled: !!host,
    queryKey: ['portal/status'],
    queryFn: async () => {
      try {
        const res = await client.get<ApiPortalStatus>(url)

        return res.data
      } catch (error) {
        return null
      }
    },
  })
}
