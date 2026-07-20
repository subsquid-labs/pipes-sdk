import { describe, expect, it } from 'vitest'

import { loadParquetjs } from './parquetjs-engine.js'

describe('parquetjs-engine', () => {
  it('loads the optional dependency once and caches the module', async () => {
    const first = await loadParquetjs()
    const second = await loadParquetjs()

    expect(first).toBe(second)
    expect(typeof first.ParquetWriter.openStream).toBe('function')
    expect(typeof first.ParquetSchema).toBe('function')
  })
})
