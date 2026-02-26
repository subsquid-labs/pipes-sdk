'use client'

import { useTables } from '~/api/clickhouse'
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'

import { TablesView } from './TablesView'

export default function TablesPage() {
  const { data: tables, isLoading, error } = useTables()

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex max-w-[1200px] flex-col gap-6 py-8">
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold">Tables</h1>
          <p className="text-sm text-slate-400">Showing all tables ordered by disk usage.</p>
        </div>

        {isLoading && <div className="text-sm text-slate-400">Loading tables...</div>}

        {error && (
          <Alert variant="destructive">
            <AlertTitle>Connection error</AlertTitle>
            <AlertDescription>
              Unable to connect to ClickHouse. Please check that the ClickHouse service is running and the connection
              settings are correct.
            </AlertDescription>
          </Alert>
        )}

        {tables && <TablesView tables={tables} />}
      </div>
    </main>
  )
}
