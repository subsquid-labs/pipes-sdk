import { describe, expect, it } from 'vitest'

import { PipeError, PortalContractViolationError, SdkErrorName } from './errors.js'

describe('PortalContractViolationError (E1004)', () => {
  it('is a fork-handling PipeError carrying code E1004 and a docs link', () => {
    const err = new PortalContractViolationError('portal delivered stale canonicalBlocks')

    expect(err).toBeInstanceOf(PipeError)
    expect(err.code).toBe('E1004')
    expect(err.name).toBe(SdkErrorName.ForkHandling)
    expect(err.message).toContain('portal delivered stale canonicalBlocks')
    expect(err.message).toContain('See: https://docs.sqd.dev/en/sdk/pipes-sdk/errors/E1004')
  })
})
