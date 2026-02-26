import { type NextRequest, NextResponse } from 'next/server'

import { fetchTableColumns } from '~/db/clickhouse'

export async function GET(request: NextRequest, { params }: { params: Promise<{ database: string; table: string }> }) {
  const { database, table } = await params
  const serverIndex = parseInt(request.nextUrl.searchParams.get('_server') ?? '0', 10)
  try {
    const columns = await fetchTableColumns(database, table, serverIndex)
    return NextResponse.json({ columns })
  } catch {
    return NextResponse.json({ error: 'Failed to fetch columns' }, { status: 502 })
  }
}
