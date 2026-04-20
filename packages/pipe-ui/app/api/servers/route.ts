import { NextResponse } from 'next/server'
import { loadConfig } from '~/lib/config'

export async function GET() {
  const config = loadConfig()

  return NextResponse.json({
    servers: config.metrics_server_url,
  })
}
