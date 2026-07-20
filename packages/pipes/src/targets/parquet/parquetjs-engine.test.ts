import { describe, expect, it } from 'vitest'

import { loadParquetjs } from './parquetjs-engine.js'

describe('parquetjs-engine', () => {
  it('loads the optional dependency once and caches the module', async () => {
    const firstCall = loadParquetjs()
    const secondCall = loadParquetjs()

    expect(firstCall).toBe(secondCall)

    const first = await firstCall
    const second = await secondCall

    expect(first).toBe(second)
    expect(typeof first.ParquetWriter.openStream).toBe('function')
    expect(typeof first.ParquetSchema).toBe('function')
  })
})
