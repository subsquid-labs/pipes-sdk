import { type NextRequest, NextResponse } from 'next/server'

import { fetchLatestQueryByHash } from '~/db/clickhouse'

export async function GET(request: NextRequest, { params }: { params: Promise<{ hash: string }> }) {
  const { hash } = await params
  if (!/^\d+$/.test(hash)) {
    return NextResponse.json({ error: 'Invalid hash' }, { status: 400 })
  }
  const serverIndex = parseInt(request.nextUrl.searchParams.get('_server') ?? '0', 10)
  try {
    const details = await fetchLatestQueryByHash(hash, serverIndex)
    return NextResponse.json({ details })
  } catch {
    return NextResponse.json({ error: 'Failed to fetch query details' }, { status: 502 })
  }
}
