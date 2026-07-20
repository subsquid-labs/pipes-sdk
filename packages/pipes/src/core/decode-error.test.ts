import { describe, expect, it } from 'vitest'

import { defaultDecodeError, recordSuppressedDecode } from '~/core/decode-error.js'
import { BatchContext } from '~/core/portal-source.js'
import { mockMetricsServer } from '~/testing/index.js'

function ctxWith(id: string) {
  const metrics = mockMetricsServer()
  const ctx = { id, metrics: metrics.server.metrics } as unknown as BatchContext

  return { ctx, metrics }
}

describe('defaultDecodeError', () => {
  it('re-throws the error it receives', () => {
    const { ctx } = ctxWith('pipe-1')
    const error = new Error('boom')

    expect(() => defaultDecodeError(ctx, error)).toThrow(error)
  })
})

describe('recordSuppressedDecode', () => {
  it('increments sqd_decode_errors_skipped_total labelled by pipe id', () => {
    const { ctx, metrics } = ctxWith('pipe-1')

    recordSuppressedDecode(ctx)
    recordSuppressedDecode(ctx)

    const skipped = metrics.counter('sqd_decode_errors_skipped_total')
    expect(skipped.total).toBe(2)
    expect(skipped.calls.every((c) => c.value === 1)).toBe(true)
    expect(skipped.calls[0].labels).toEqual({ id: 'pipe-1' })
  })
})
