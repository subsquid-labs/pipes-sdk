import { type NextRequest, NextResponse } from 'next/server'

import { fetchRecentQueries, parseQueryLogWindow } from '~/db/clickhouse'

export async function GET(request: NextRequest) {
  const interval = request.nextUrl.searchParams.get('interval') ?? undefined
  const serverIndex = parseInt(request.nextUrl.searchParams.get('_server') ?? '0', 10)
  const window = parseQueryLogWindow(interval)
  try {
    const queries = await fetchRecentQueries(window, serverIndex)
    return NextResponse.json({ queries })
  } catch {
    return NextResponse.json({ error: 'Failed to fetch queries' }, { status: 502 })
  }
}
