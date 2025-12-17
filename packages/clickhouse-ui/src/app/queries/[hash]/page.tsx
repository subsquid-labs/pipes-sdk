import Link from 'next/link'
import { notFound } from 'next/navigation'

import { SqlHighlight } from '~/components/SqlHighlight/SqlHighlight'
import { Badge } from '~/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '~/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '~/components/ui/tooltip'
import { fetchExplainPipeline, fetchExplainPlan, fetchLatestQueryByHash } from '~/db/clickhouse'
import { formatBytes, formatNumber, formatSeconds } from '~/lib/format'

export const dynamic = 'force-dynamic'

type Props = {
  params: Promise<{ hash: string }>
}

const PROFILE_EVENT_DESCRIPTIONS: Record<string, string> = {
  NetworkSendElapsedMicroseconds: 'Time spent sending result data to the client (socket backpressure / slow client)',
  OSCPUVirtualTimeMicroseconds: 'CPU time actually executed by ClickHouse for this query',
  OSCPUWaitMicroseconds: 'Time runnable but waiting to get CPU (scheduler/CPU contention)',
  SynchronousReadWaitMicroseconds: 'Time waiting for synchronous reads (I/O wait)',
  DiskReadElapsedMicroseconds: 'Elapsed time spent performing disk read operations',
  ThreadPoolReaderPageCacheMissElapsedMicroseconds: 'Read time when page cache missed (had to fetch from storage)',
  ThreadPoolReaderPageCacheHitElapsedMicroseconds: 'Read time when page cache hit (served from cache)',
  FilteringMarksWithPrimaryKeyMicroseconds: 'Time skipping marks using primary key condition (index pruning)',
  LocalThreadPoolThreadCreationMicroseconds: 'Overhead of creating threads in the local thread pool',
  WaitMarksLoadMicroseconds: 'Time waiting for MergeTree marks to load',
  OpenedFileCacheMicroseconds: 'Overhead of opened file cache management/lookups',
  QueryPlanOptimizeMicroseconds: 'Time spent optimizing the query plan',
  GlobalThreadPoolLockWaitMicroseconds: 'Time waiting on global thread pool locks',
  LocalThreadPoolLockWaitMicroseconds: 'Time waiting on local thread pool locks',
  SharedPartsLockHoldMicroseconds: 'Time holding locks on shared parts metadata',
  PartsLockHoldMicroseconds: 'Time holding locks on parts metadata',
  AnalyzePatchRangesMicroseconds: 'Overhead analyzing patch ranges',
  JoinOptimizeMicroseconds: 'Time spent optimizing JOIN operations',
  JoinReorder: 'Time spent reordering JOINs for better performance',
}

const TIME_BREAKDOWN_DESCRIPTIONS: Record<'real' | 'user' | 'system' | 'other', string> = {
  real: 'RealTimeMicroseconds total wall clock time from start to finish',
  user: 'UserTimeMicroseconds CPU time spent in user space by ClickHouse threads while executing this query',
  system:
    'SystemTimeMicroseconds CPU time spent in kernel space on behalf of this query (syscalls, network, disk, etc)',
  other:
    'Real time minus (user + system) time mostly waiting or overhead (network send backpressure, I/O waits, scheduling, locks)',
}

const RESOURCE_DESCRIPTIONS: Record<
  | 'query_duration_ms'
  | 'read_rows'
  | 'read_bytes'
  | 'result_rows'
  | 'result_bytes'
  | 'written_rows'
  | 'written_bytes'
  | 'memory_usage',
  string
> = {
  query_duration_ms: 'QueryDurationMs elapsed execution time as recorded in system.query_log',
  read_rows: 'Number of rows read from storage',
  read_bytes: 'Number of bytes read from storage',
  result_rows: 'Number of rows in the result',
  result_bytes: 'Number of bytes in the result',
  written_rows: 'Number of rows written',
  written_bytes: 'Number of bytes written',
  memory_usage: 'Peak memory usage of the query',
}

export default async function QueryDetailsPage({ params }: Props) {
  const { hash } = await params
  if (!/^\d+$/.test(hash)) {
    return notFound()
  }

  const details = await fetchLatestQueryByHash(hash)
  if (!details) {
    return notFound()
  }

  const [planResult, pipelineResult] = await Promise.allSettled([
    fetchExplainPlan(details.query),
    fetchExplainPipeline(details.query),
  ])

  const explainPlan = planResult.status === 'fulfilled' ? planResult.value : null
  const explainPlanError =
    planResult.status === 'rejected' ? String((planResult.reason as any)?.message ?? planResult.reason) : null

  const explainPipeline = pipelineResult.status === 'fulfilled' ? pipelineResult.value : null
  const explainPipelineError =
    pipelineResult.status === 'rejected'
      ? String((pipelineResult.reason as any)?.message ?? pipelineResult.reason)
      : null

  const showRead = details.query_kind === 'Select'

  const microEvents = Object.entries(details.profile)
    .filter(
      ([name]) =>
        /Microseconds$/.test(name) &&
        name !== 'RealTimeMicroseconds' &&
        name !== 'UserTimeMicroseconds' &&
        name !== 'SystemTimeMicroseconds',
    )
    .sort((a, b) => Number(b[1]) - Number(a[1]))

  const microEventsTotalMicroseconds = microEvents.reduce((total, [, value]) => total + Number(value), 0)

  return (
    <main
      style={{
        minHeight: '100vh',
        padding: '2rem',
        backgroundColor: '#020617',
        color: '#e2e8f0',
      }}
    >
      <div className="mx-auto max-w-[1200px] space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm text-slate-400">
              <Link href="/queries" className="underline underline-offset-4">
                ← Back to queries
              </Link>
            </div>
            <h1 className="mt-2 text-2xl font-semibold">Query</h1>
            <div className="mt-1 text-sm text-slate-400">
              Hash: {details.query_hash} · User: {details.user || '(unknown)'} · Query ID: {details.query_id || '—'} ·
              Event time: {details.event_time || '—'}
            </div>
          </div>
        </div>

        <Tabs defaultValue="profiling">
          <TabsList className="bg-slate-950/60 border border-border/80 text-slate-300">
            <TabsTrigger
              value="profiling"
              className="data-[state=active]:bg-slate-900/60 data-[state=active]:text-slate-100"
            >
              Profiling
            </TabsTrigger>
            <TabsTrigger
              value="explain"
              className="data-[state=active]:bg-slate-900/60 data-[state=active]:text-slate-100"
            >
              Explain
            </TabsTrigger>
          </TabsList>

          <TabsContent value="explain" className="space-y-4">
            <div className="rounded-xl border border-border/80 bg-slate-950/60">
              <div className="px-4 py-3 border-b border-border/80">
                <h2 className="text-lg font-semibold">EXPLAIN PLAN</h2>
              </div>
              <div className="p-4">
                {explainPlan ? (
                  <pre className="whitespace-pre-wrap break-words text-xs text-slate-100">{explainPlan}</pre>
                ) : (
                  <div className="text-sm text-slate-400">
                    Unable to run EXPLAIN PLAN{explainPlanError ? `: ${explainPlanError}` : ''}
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-border/80 bg-slate-950/60">
              <div className="px-4 py-3 border-b border-border/80">
                <h2 className="text-lg font-semibold">EXPLAIN PIPELINE</h2>
              </div>
              <div className="p-4">
                {explainPipeline ? (
                  <pre className="whitespace-pre-wrap break-words text-xs text-slate-100">{explainPipeline}</pre>
                ) : (
                  <div className="text-sm text-slate-400">
                    Unable to run EXPLAIN PIPELINE{explainPipelineError ? `: ${explainPipelineError}` : ''}
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-border/80 bg-slate-950/60">
              <div className="px-4 py-3 border-b border-border/80">
                <h2 className="text-lg font-semibold">Query</h2>
              </div>
              <div className="p-4">
                <SqlHighlight sql={details.query} className="block rounded-xl text-xs border bg-opacity-10 p-3" />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="profiling">
            <div className="flex items-start gap-2">
              <div className="rounded-xl flex-1 border border-border/80 mb-6">
                <div className="px-4 py-3 border-b border-border/80">
                  <h2 className="text-lg font-semibold">Time breakdown</h2>
                  <p className="mt-1 text-sm text-slate-400">Real time is the wall clock time</p>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-900/40">
                      <TableHead>Metric</TableHead>
                      <TableHead className="text-right text-nowrap">Seconds</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell>
                        Real time
                        <div className="mt-1 text-xs text-slate-400">{TIME_BREAKDOWN_DESCRIPTIONS.real}</div>
                      </TableCell>
                      <TableCell className="text-right text-sm">{formatSeconds(details.real_time_secs)}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>
                        User time
                        <div className="mt-1 text-xs text-slate-400">{TIME_BREAKDOWN_DESCRIPTIONS.user}</div>
                      </TableCell>
                      <TableCell className="text-right">{formatSeconds(details.user_time_secs)}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>
                        Sys time
                        <div className="mt-1 text-xs text-slate-400">{TIME_BREAKDOWN_DESCRIPTIONS.system}</div>
                      </TableCell>
                      <TableCell className="text-right">{formatSeconds(details.system_time_secs)}</TableCell>
                    </TableRow>

                    <TableRow>
                      <TableCell className="text-slate-300">
                        Other / waiting
                        <div className="mt-1 text-xs text-slate-500">{TIME_BREAKDOWN_DESCRIPTIONS.other}</div>
                      </TableCell>
                      <TableCell className="text-right text-slate-300">
                        {formatSeconds(details.real_time_secs - details.user_time_secs - details.system_time_secs)}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>

              <div className="rounded-xl flex-1 border border-border/80 bg-slate-950/60 mb-6">
                <div className="px-4 py-3 border-b border-border/80">
                  <h2 className="text-lg font-semibold">Resources</h2>
                  <p className="mt-1 text-sm text-slate-400">Result size and memory</p>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-900/40">
                      <TableHead>Metric</TableHead>
                      <TableHead className="text-right text-nowrap">Value</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell>
                        Duration
                        <div className="mt-1 text-xs text-slate-400">{RESOURCE_DESCRIPTIONS.query_duration_ms}</div>
                      </TableCell>
                      <TableCell className="text-right text-nowrap">
                        {formatSeconds(details.query_duration_ms / 1000)} s
                      </TableCell>
                    </TableRow>
                    {showRead ? (
                      <>
                        <TableRow>
                          <TableCell>
                            Read rows
                            <div className="mt-1 text-xs text-slate-400">{RESOURCE_DESCRIPTIONS.read_rows}</div>
                          </TableCell>
                          <TableCell className="text-right">{formatNumber(details.read_rows)}</TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell>
                            Read bytes
                            <div className="mt-1 text-xs text-slate-400">{RESOURCE_DESCRIPTIONS.read_bytes}</div>
                          </TableCell>
                          <TableCell className="text-right">{formatBytes(details.read_bytes)}</TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell>
                            Result rows
                            <div className="mt-1 text-xs text-slate-400">{RESOURCE_DESCRIPTIONS.result_rows}</div>
                          </TableCell>
                          <TableCell className="text-right">{formatNumber(details.result_rows)}</TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell>
                            Result bytes
                            <div className="mt-1 text-xs text-slate-400">{RESOURCE_DESCRIPTIONS.result_bytes}</div>
                          </TableCell>
                          <TableCell className="text-right">{formatBytes(details.result_bytes)}</TableCell>
                        </TableRow>
                      </>
                    ) : (
                      <>
                        <TableRow>
                          <TableCell>
                            Written rows
                            <div className="mt-1 text-xs text-slate-400">{RESOURCE_DESCRIPTIONS.written_rows}</div>
                          </TableCell>
                          <TableCell className="text-right">{formatNumber(details.written_rows)}</TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell>
                            Written bytes
                            <div className="mt-1 text-xs text-slate-400">{RESOURCE_DESCRIPTIONS.written_bytes}</div>
                          </TableCell>
                          <TableCell className="text-right">{formatBytes(details.written_bytes)}</TableCell>
                        </TableRow>
                      </>
                    )}
                    <TableRow>
                      <TableCell>
                        Memory usage (peak)
                        <div className="mt-1 text-xs text-slate-400">{RESOURCE_DESCRIPTIONS.memory_usage}</div>
                      </TableCell>
                      <TableCell className="text-right">{formatBytes(details.memory_usage)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>

              <div className="rounded-xl flex-1 border border-border/80 bg-slate-950/60">
                <div className="px-4 py-3 border-b border-border/80">
                  <h2 className="text-lg font-semibold">Query breakdown</h2>
                  <p className="mt-1 text-sm text-slate-400">Sorted by time</p>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-900/40">
                      <TableHead>Event</TableHead>
                      <TableHead className="text-right text-nowrap">Seconds</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {microEvents.map(([name, value]) => (
                      <TableRow key={name}>
                        <TableCell className="font-mono text-xs">
                          {name.replace(/Microseconds$/, '')}

                          {PROFILE_EVENT_DESCRIPTIONS[name] && (
                            <div className="mt-1 font-sans text-xs text-slate-400">
                              {PROFILE_EVENT_DESCRIPTIONS[name]}
                            </div>
                          )}

                          {name === 'OSCPUWaitMicroseconds' && Number(value) / 1_000_000 > 0.1 && (
                            <div className="mt-2">
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Badge
                                      variant="outline"
                                      className="border-amber-500/70 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20"
                                    >
                                      High CPU wait
                                    </Badge>
                                  </TooltipTrigger>
                                  <TooltipContent className="max-w-xs text-left">
                                    <p>
                                      The OSCPUWaitMicroseconds metric, compared to OSCPUVirtualTimeMicroseconds, helps
                                      determine the CPU overload level. When the wait time is high, it means that
                                      processes (including ClickHouse&apos;s background operations and user queries) are
                                      competing for CPU time and being queued by the operating system.
                                    </p>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatNumber(Number(value) / 1_000_000, { maximumFractionDigits: 6 })}
                        </TableCell>
                      </TableRow>
                    ))}
                    {microEvents.length > 0 && (
                      <TableRow>
                        <TableCell className="font-semibold">Total</TableCell>
                        <TableCell className="text-right font-semibold">
                          {formatNumber(microEventsTotalMicroseconds / 1_000_000, { maximumFractionDigits: 6 })}
                        </TableCell>
                      </TableRow>
                    )}
                    {microEvents.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={2} className="py-4 text-center text-slate-500">
                          No profile events found for this query.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </main>
  )
}
