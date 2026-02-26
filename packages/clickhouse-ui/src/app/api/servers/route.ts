import { NextResponse } from 'next/server'

import { getServerList } from '~/db/clickhouse'

export async function GET() {
  return NextResponse.json({ servers: getServerList() })
}
