import type { BatchContext } from './portal-source.js'

/**
 * Decode-error hook contract shared by every network decoder (ADR-12).
 *
 * One uniform policy: a decode failure is fatal by default, but a hook that
 * returns without throwing suppresses the offending record. Suppressions are
 * counted (INV-31) so a dropped record never vanishes silently.
 */
export type DecodeErrorHook = (ctx: BatchContext, error: any) => unknown | Promise<unknown>

export const defaultDecodeError: DecodeErrorHook = (ctx, error) => {
  throw error
}

export function recordSuppressedDecode(ctx: BatchContext) {
  ctx.metrics
    .counter({
      name: 'sqd_decode_errors_skipped_total',
      help: 'Records dropped by a returning (non-throwing) onError decode hook',
      labelNames: ['id'] as const,
    })
    .inc({ id: ctx.id }, 1)
}
