'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'

import type { ClickhouseTableRow } from '~/api/clickhouse'
import { Button } from '~/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '~/components/ui/table'
import { formatNumber } from '~/lib/format'

type Props = {
  tables: ClickhouseTableRow[]
}

export function TablesView({ tables }: Props) {
  const databases = useMemo(() => Array.from(new Set(tables.map((t) => t.database))).sort(), [tables])

  const [disabledDbs, setDisabledDbs] = useState<string[]>([])

  const toggleDb = (db: string) => {
    setDisabledDbs((prev) => (prev.includes(db) ? prev.filter((x) => x !== db) : [...prev, db]))
  }

  const showAll = () => setDisabledDbs([])
  const hideAll = () => setDisabledDbs(databases)

  const visibleTables = useMemo(() => tables.filter((t) => !disabledDbs.includes(t.database)), [tables, disabledDbs])

  return (
    <>
      {databases.length > 0 && (
        <div className="space-y-3 rounded-xl border border-border/80 bg-slate-950/60 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm font-semibold text-slate-200">Databases</span>
            <div className="flex items-center gap-2 text-xs">
              <Button variant="outline" size="sm" onClick={showAll}>
                Enable all
              </Button>
              <Button variant="outline" size="sm" onClick={hideAll}>
                Disable all
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {databases.map((db) => {
              const disabled = disabledDbs.includes(db)
              return (
                <Button
                  key={db}
                  variant={disabled ? 'outline' : 'secondary'}
                  size="sm"
                  onClick={() => toggleDb(db)}
                  className="rounded-full"
                >
                  {db || '(unknown database)'}
                </Button>
              )
            })}
          </div>
        </div>
      )}

      <div className="rounded-xl border border-border/80 bg-slate-950/60">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-900/40">
              <TableHead>Database</TableHead>
              <TableHead className="text-right">Rows</TableHead>
              <TableHead className="text-right">Disk size</TableHead>
              <TableHead className="text-right">PK size</TableHead>
              <TableHead className="text-right">Uncompressed</TableHead>
              <TableHead className="text-right">Ratio</TableHead>
              <TableHead className="w-48">Last modified</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleTables.map((t, idx) => {
              const href = `/${encodeURIComponent(t.database)}/${encodeURIComponent(t.table)}`

              return (
                <TableRow key={`${t.database}.${t.table}.${idx}`}>
                  <TableCell>
                    <div className="text-[11px] text-slate-500">
                      {t.database ? <span>{t.database}</span> : <span>(unknown)</span>}
                    </div>
                    <Link href={href} className="text-sm">
                      {t.table || '(unknown table)'}
                    </Link>
                    <div className="text-[11px] text-slate-500">{t.engine}</div>
                  </TableCell>
                  <TableCell className="text-right text-nowrap">{formatNumber(t.rows)}</TableCell>
                  <TableCell className="text-right text-nowrap">{t.disk_size}</TableCell>
                  <TableCell className="text-right">{t.primary_keys_size}</TableCell>
                  <TableCell className="text-right">{t.uncompressed_size ?? '—'}</TableCell>
                  <TableCell className="text-right">
                    {formatNumber(t.ratio, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell className="text-xs text-slate-400">{t.latest_modification}</TableCell>
                </TableRow>
              )
            })}
            {visibleTables.length === 0 && (
              <TableRow>
                <TableCell colSpan={10} className="py-4 text-center text-slate-500">
                  No tables to display with the current filters.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </>
  )
}
