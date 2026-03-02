import { NextRequest } from 'next/server'

import { proxyMetrics } from '~/lib/proxy'

export async function GET(request: NextRequest) {
  return proxyMetrics(request, '/exemplars/transformation')
}
