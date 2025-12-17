import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { type ClickhouseTableRow, fetchClickhouseTables } from '~/db/clickhouse'
import { TablesView } from './TablesView'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  let tables: ClickhouseTableRow[] = []
  let error: string | null = null

  try {
    tables = await fetchClickhouseTables()
  } catch (e) {
    console.error('Error fetching tables from ClickHouse:', e)
    error =
      'Unable to connect to ClickHouse. Please check that the ClickHouse service is running and the connection settings are correct.'
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex max-w-[1200px] flex-col gap-6 py-8">
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold">Tables</h1>
          <p className="text-sm text-slate-400">Showing all tables ordered by disk usage.</p>
        </div>

        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Connection error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : (
          <TablesView tables={tables} />
        )}
      </div>
    </main>
  )
}
