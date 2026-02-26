'use client'

import Link from 'next/link'
import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'

import { parseQueryLogWindow, queryLogWindowLabel, useRecentQueries } from '~/api/clickhouse'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '~/components/ui/table'
import { formatNumber, formatSeconds } from '~/lib/format'

import { QueryLogWindowSelect } from './QueryLogWindowSelect'
import { QueryPreview } from './QueryPreview'
import { type TimeMode, TimeModeToggle } from './TimeModeToggle'

export default function QueriesPage() {
  return (
    <Suspense>
      <QueriesContent />
    </Suspense>
  )
}

function QueriesContent() {
  const searchParams = useSearchParams()
  const interval = parseQueryLogWindow(searchParams.get('interval'))
  const windowLabel = queryLogWindowLabel(interval)
  const timeMode: TimeMode = searchParams.get('time') === 'total' ? 'total' : 'avg'

  const { data: queries = [], error } = useRecentQueries(interval)

  const totalQueries = queries.reduce((acc, q) => acc + q.count, 0)

  return (
    <main
      style={{
        minHeight: '100vh',
        padding: '2rem',
        backgroundColor: '#020617',
        color: '#e2e8f0',
      }}
    >
      <div className="mx-auto  max-w-[1200px]">
        <div className="flex items-end justify-between mb-4">
          <div>
            <h1
              style={{
                fontSize: '1.75rem',
                fontWeight: 600,
                marginBottom: '0.5rem',
              }}
            >
              Stats
            </h1>
            <p className="text-sm text-slate-400">
              {queries.length} unique query templates and total {formatNumber(totalQueries)} queries in the last{' '}
              {windowLabel}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <TimeModeToggle value={timeMode} />
            <span className="text-slate-400">for</span>
            <QueryLogWindowSelect value={interval} />
          </div>
        </div>

        {error && (
          <div
            style={{
              marginBottom: '1.5rem',
              padding: '0.75rem 1rem',
              borderRadius: '0.5rem',
              backgroundColor: '#450a0a',
              border: '1px solid #7f1d1d',
              color: '#fecaca',
              fontSize: '0.875rem',
            }}
          >
            Unable to load recent queries from ClickHouse. Please check that the ClickHouse service is running and the
            connection settings are correct.
          </div>
        )}

        <div className="rounded-xl border border-border/80 bg-slate-950/60">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-900/40">
                <TableHead className="">Query</TableHead>
                <TableHead className="w-[50%]">Example</TableHead>
                <TableHead
                  className="text-right text-nowrap cursor-help"
                  title="UserTimeMicroseconds = сколько секунд человек печатал код"
                >
                  User time
                </TableHead>
                <TableHead
                  className="text-right text-nowrap cursor-help"
                  title="SystemTimeMicroseconds = сколько ОС обслуживала его запросы"
                >
                  Sys time
                </TableHead>
                <TableHead
                  className="text-right text-nowrap cursor-help"
                  title="RealTimeMicroseconds = сколько прошло времени на часах"
                >
                  Real time
                </TableHead>
                <TableHead className="text-right text-nowrap">Requests</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {queries.map((q) => (
                <TableRow key={`${q.user}.${q.query_hash}.${q.query}`}>
                  <TableCell>
                    <Link href={`/queries/${q.query_hash}`} className="flex text-sm underline underline-offset-4">
                      {q.query_hash || '(unknown)'}
                    </Link>
                    <div className="text-slate-400 text-xs">User: {q.user || '(unknown)'}</div>
                  </TableCell>
                  <TableCell className="whitespace-pre-wrap break-words max-w-[150px]">
                    <QueryPreview sql={q.query} />
                  </TableCell>
                  {timeMode === 'avg' ? (
                    <>
                      <TableCell className="text-right align-top">{formatSeconds(q.avg_user_time_secs)}</TableCell>
                      <TableCell className="text-right">{formatSeconds(q.avg_system_time_secs)}</TableCell>
                      <TableCell className="text-right text-[14px]">{formatSeconds(q.avg_real_time_secs)}</TableCell>
                    </>
                  ) : (
                    <>
                      <TableCell className="text-right">{formatSeconds(q.total_user_time_secs)}</TableCell>
                      <TableCell className="text-right">{formatSeconds(q.total_system_time_secs)}</TableCell>
                      <TableCell className="text-right text-sm">{formatSeconds(q.total_real_time_secs)}</TableCell>
                    </>
                  )}
                  <TableCell className="text-right">{formatNumber(q.count)}</TableCell>
                </TableRow>
              ))}
              {queries.length === 0 && !error && (
                <TableRow>
                  <TableCell colSpan={7} className="py-4 text-center text-slate-500">
                    No queries recorded in the last {windowLabel}.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </main>
  )
}
