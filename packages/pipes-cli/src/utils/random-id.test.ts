import { describe, expect, it } from 'vitest'

import { generatePipeId } from './random-id.js'

describe('generatePipeId', () => {
  it('should return an 8-character hex string', () => {
    const id = generatePipeId()
    expect(id).toHaveLength(8)
    expect(id).toMatch(/^[0-9a-f]{8}$/)
  })

  it('should return unique values across two calls', () => {
    const id1 = generatePipeId()
    const id2 = generatePipeId()
    expect(id1).not.toBe(id2)
  })
})
