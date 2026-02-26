import { type NextRequest, NextResponse } from 'next/server'

import { fetchExplainPipeline, fetchExplainPlan, fetchLatestQueryByHash } from '~/db/clickhouse'

export async function GET(request: NextRequest, { params }: { params: Promise<{ hash: string }> }) {
  const { hash } = await params
  if (!/^\d+$/.test(hash)) {
    return NextResponse.json({ error: 'Invalid hash' }, { status: 400 })
  }
  const serverIndex = parseInt(request.nextUrl.searchParams.get('_server') ?? '0', 10)
  try {
    const details = await fetchLatestQueryByHash(hash, serverIndex)
    if (!details) {
      return NextResponse.json({ error: 'Query not found' }, { status: 404 })
    }

    const [planResult, pipelineResult] = await Promise.allSettled([
      fetchExplainPlan(details.query, serverIndex),
      fetchExplainPipeline(details.query, serverIndex),
    ])

    return NextResponse.json({
      plan: planResult.status === 'fulfilled' ? planResult.value : null,
      planError:
        planResult.status === 'rejected'
          ? String((planResult.reason as any)?.message ?? planResult.reason)
          : null,
      pipeline: pipelineResult.status === 'fulfilled' ? pipelineResult.value : null,
      pipelineError:
        pipelineResult.status === 'rejected'
          ? String((pipelineResult.reason as any)?.message ?? pipelineResult.reason)
          : null,
    })
  } catch {
    return NextResponse.json({ error: 'Failed to fetch explain data' }, { status: 502 })
  }
}
