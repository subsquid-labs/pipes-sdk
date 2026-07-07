import { describe, expect, it } from 'vitest'

import { ClickhouseState } from './clickhouse-state.js'

function block(number: number, hash?: string) {
  return { number, hash: hash ?? `0x${number}` }
}

/**
 * Minimal ClickhouseStore stub: `fork()` only reads rows back through `store.query().stream()`,
 * so we hand it canned rows (newest first, as the real `ORDER BY timestamp DESC` returns them)
 * without a live ClickHouse. Not an HTTP mock — a store stub, matching how `fork()` consumes it.
 */
function forkStore(rows: { rollback_chain: string; finalized: string }[]) {
  const store = {
    client: { connectionParams: { database: 'default' } },
    query: async () => ({
      stream: async function* () {
        yield rows.map((r) => ({ json: () => r }))
      },
    }),
  }

  return { store }
}

describe('ClickhouseState — fork', () => {
  it('skips an offset with no finalized head instead of crashing on JSON.parse(\'\')', async () => {
    // A source that never reported a finalized head persists finalized as '' with an empty
    // rollback chain. Unpatched, `JSON.parse('')` throws "Unexpected end of JSON input" and the
    // stream crash-loops on every restart; fork resolution must skip the row and return null.
    const { store } = forkStore([{ rollback_chain: '[]', finalized: '' }])
    const state = new ClickhouseState(store as any, {})

    await expect(state.fork([block(5)])).resolves.toBeNull()
  })

  it('resolves normally when a finalized head is present', async () => {
    const { store } = forkStore([
      { rollback_chain: JSON.stringify([block(5), block(6)]), finalized: JSON.stringify(block(4)) },
    ])
    const state = new ClickhouseState(store as any, {})

    const safe = await state.fork([block(5), block(6, '0x6a')])

    expect(safe).toEqual(block(5))
  })

  it('skips a leading empty-cursor row and resolves from a later valid row', async () => {
    // The empty-finalized row is newest (DESC), the valid row follows it. The guard must let the
    // scan skip the empty row and still resolve the fork from the older, populated row.
    const { store } = forkStore([
      { rollback_chain: '[]', finalized: '' },
      { rollback_chain: JSON.stringify([block(5), block(6)]), finalized: JSON.stringify(block(4)) },
    ])
    const state = new ClickhouseState(store as any, {})

    const safe = await state.fork([block(5), block(6, '0x6a')])

    expect(safe).toEqual(block(5))
  })
})
