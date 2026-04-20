import { type NextRequest, NextResponse } from 'next/server'
import { loadConfig } from '~/lib/config'

function getServerUrl(serverIndex: number): string | null {
  const config = loadConfig()
  const server = config.metrics_server_url[serverIndex]
  return server?.url ?? null
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params
  const serverIndex = parseInt(request.nextUrl.searchParams.get('_server') ?? '0', 10)
  const baseUrl = getServerUrl(serverIndex)

  if (!baseUrl) {
    return NextResponse.json({ error: 'Invalid server index' }, { status: 400 })
  }

  const metricsPath = '/' + path.join('/')

  const forwardParams = new URLSearchParams(request.nextUrl.searchParams)
  forwardParams.delete('_server')

  const query = forwardParams.toString()
  const targetUrl = `${baseUrl}${metricsPath}${query ? `?${query}` : ''}`

  try {
    const res = await fetch(targetUrl, {
      headers: { Accept: 'application/json' },
    })

    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ error: 'Failed to reach metrics server' }, { status: 502 })
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params
  const serverIndex = parseInt(request.nextUrl.searchParams.get('_server') ?? '0', 10)
  const baseUrl = getServerUrl(serverIndex)

  if (!baseUrl) {
    return NextResponse.json({ error: 'Invalid server index' }, { status: 400 })
  }

  const metricsPath = '/' + path.join('/')

  const forwardParams = new URLSearchParams(request.nextUrl.searchParams)
  forwardParams.delete('_server')

  const query = forwardParams.toString()
  const targetUrl = `${baseUrl}${metricsPath}${query ? `?${query}` : ''}`

  try {
    const body = await request.text()
    const res = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body,
    })

    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ error: 'Failed to reach metrics server' }, { status: 502 })
  }
}
