import { type NextRequest, NextResponse } from 'next/server'

import { fetchClickhouseVersion } from '~/db/clickhouse'

export async function GET(request: NextRequest) {
  const serverIndex = parseInt(request.nextUrl.searchParams.get('_server') ?? '0', 10)
  try {
    const version = await fetchClickhouseVersion(serverIndex)
    return NextResponse.json({ version })
  } catch {
    return NextResponse.json({ version: null }, { status: 502 })
  }
}
