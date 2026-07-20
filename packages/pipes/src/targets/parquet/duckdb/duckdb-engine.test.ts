import { describe, expect, it } from 'vitest'

import { acquireDuckdbInstance, loadDuckdbApi } from './duckdb-engine.js'

describe('duckdb-engine', () => {
  it('loads the optional dependency once and caches the module', async () => {
    const first = await loadDuckdbApi()
    const second = await loadDuckdbApi()

    expect(first).toBe(second)
    expect(typeof first.DuckDBInstance.create).toBe('function')
  })

  it('shares one instance per (threads, memoryLimit) config and applies the config', async () => {
    const a = await acquireDuckdbInstance({ threads: 2, memoryLimit: '2GB' })
    const b = await acquireDuckdbInstance({ threads: 2, memoryLimit: '2GB' })
    const other = await acquireDuckdbInstance({ threads: 1, memoryLimit: '2GB' })

    expect(a).toBe(b)
    expect(other).not.toBe(a)

    const connection = await a.connect()
    try {
      const result = await connection.runAndReadAll(
        "SELECT current_setting('threads') AS threads, current_setting('memory_limit') AS memory",
      )
      // '2GB' formats as '1.8 GiB' (spike-verified, deterministic binary-scale formatting).
      expect(result.getRowObjects()).toEqual([{ threads: 2n, memory: '1.8 GiB' }])
    } finally {
      connection.disconnectSync()
    }
  })

  it('defaults to threads=2 / memoryLimit=2GB (same cache slot as the explicit defaults)', async () => {
    expect(await acquireDuckdbInstance()).toBe(await acquireDuckdbInstance({ threads: 2, memoryLimit: '2GB' }))
  })
})
