import { type NextRequest, NextResponse } from 'next/server'

import { fetchTableDefinition } from '~/db/clickhouse'

export async function GET(request: NextRequest, { params }: { params: Promise<{ database: string; table: string }> }) {
  const { database, table } = await params
  const serverIndex = parseInt(request.nextUrl.searchParams.get('_server') ?? '0', 10)
  try {
    const definition = await fetchTableDefinition(database, table, serverIndex)
    return NextResponse.json({ definition })
  } catch {
    return NextResponse.json({ error: 'Failed to fetch definition' }, { status: 502 })
  }
}
