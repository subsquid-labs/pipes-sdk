import { NextRequest, NextResponse } from 'next/server'

import { loadConfig } from '~/lib/config'

export function getMetricsServerUrl(request: NextRequest): string | null {
  const serverIndex = Number(request.nextUrl.searchParams.get('_server') ?? '0')
  const config = loadConfig()
  return config.metrics_server_url[serverIndex]?.url ?? null
}

export async function proxyMetrics(request: NextRequest, path: string): Promise<NextResponse> {
  const serverUrl = getMetricsServerUrl(request)
  if (!serverUrl) {
    return NextResponse.json({ error: 'Invalid server index' }, { status: 400 })
  }

  // Forward all query params except _server
  const params = new URLSearchParams(request.nextUrl.searchParams)
  params.delete('_server')
  const qs = params.toString()
  const url = `${serverUrl}${path}${qs ? `?${qs}` : ''}`

  try {
    const res = await fetch(url)
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ error: 'Metrics server unavailable' }, { status: 502 })
  }
}
