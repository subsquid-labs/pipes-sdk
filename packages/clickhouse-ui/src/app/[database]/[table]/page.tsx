'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'

import { useTableColumns, useTableDefinition } from '~/api/clickhouse'
import { SqlHighlight } from '~/components/SqlHighlight/SqlHighlight'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '~/components/ui/table'
import { formatNumber } from '~/lib/format'

export default function TablePage() {
  const params = useParams<{ database: string; table: string }>()
  const database = decodeURIComponent(params.database)
  const table = decodeURIComponent(params.table)

  const { data: columns = [], isLoading, error } = useTableColumns(database, table)
  const { data: definition } = useTableDefinition(database, table)

  return (
    <main
      style={{
        minHeight: '100vh',
        padding: '2rem',
        backgroundColor: '#020617',
        color: '#e2e8f0',
      }}
    >
      <div
        style={{
          maxWidth: '1200px',
          margin: '0 auto',
        }}
      >
        <div
          style={{
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '1.5rem',
          }}
        >
          <div className="mb-2">
            <Link href="/tables">← Back to tables</Link>
          </div>
          <div>
            <h1
              style={{
                fontSize: '1.75rem',
                fontWeight: 600,
                marginBottom: '0.25rem',
              }}
            >
              {database}.{table}
            </h1>
            <p style={{ color: '#94a3b8', fontSize: '0.875rem' }}>
              Column-level storage stats (sizes, compression, avg bytes per row).
            </p>
          </div>
        </div>

        {isLoading && <div className="text-sm text-slate-400 mb-4">Loading column stats...</div>}

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
            Unable to load column statistics from ClickHouse. Please check that the ClickHouse service is running and
            the connection settings are correct.
          </div>
        )}

        {!error && definition && (
          <div
            style={{
              marginBottom: '1.5rem',
              borderRadius: '0.75rem',
              border: '1px solid #0f172a',
              backgroundColor: '#020617',
              padding: '1rem',
            }}
          >
            <div style={{ marginBottom: '0.5rem', fontWeight: 600 }}>Table definition</div>
            <SqlHighlight sql={definition} className="m-0 overflow-x-auto text-xs leading-relaxed text-slate-100" />
          </div>
        )}

        <div
          style={{
            overflowX: 'auto',
            borderRadius: '0.75rem',
            border: '1px solid #0f172a',
            backgroundColor: '#020617',
          }}
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-48">Column</TableHead>
                <TableHead className="text-right">Compressed size</TableHead>
                <TableHead className="text-right">Uncompressed size</TableHead>
                <TableHead className="text-right">Compression ratio</TableHead>
                <TableHead className="text-right">Total rows</TableHead>
                <TableHead className="text-right">Avg bytes/row (uncompressed)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {columns.map((c) => (
                <TableRow key={c.column}>
                  <TableCell className="font-mono text-sm">{c.column}</TableCell>
                  <TableCell className="text-right">{c.compressed_size}</TableCell>
                  <TableCell className="text-right">{c.uncompressed_size}</TableCell>
                  <TableCell className="text-right">{formatNumber(c.compression_ratio)}</TableCell>
                  <TableCell className="text-right">{formatNumber(c.total_rows)}</TableCell>
                  <TableCell className="text-right">
                    {formatNumber(c.avg_bytes_per_row_uncompressed, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </TableCell>
                </TableRow>
              ))}
              {columns.length === 0 && !error && !isLoading && (
                <TableRow>
                  <TableCell colSpan={6} className="py-4 text-center text-slate-500">
                    No column stats found for this table.
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
