import { type NextRequest, NextResponse } from 'next/server'

import { fetchClickhouseTables } from '~/db/clickhouse'

export async function GET(request: NextRequest) {
  const serverIndex = parseInt(request.nextUrl.searchParams.get('_server') ?? '0', 10)
  try {
    const tables = await fetchClickhouseTables(serverIndex)
    return NextResponse.json({ tables })
  } catch {
    return NextResponse.json({ error: 'Failed to fetch tables' }, { status: 502 })
  }
}
