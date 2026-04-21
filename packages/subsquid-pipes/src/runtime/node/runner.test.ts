import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createDevRunner } from './runner.js'

describe('createDevRunner', () => {
  const originalLogLevel = process.env['LOG_LEVEL']

  beforeEach(() => {
    // Silence the default logger created inside Runner so test output stays clean.
    process.env['LOG_LEVEL'] = 'silent'
  })

  afterEach(() => {
    if (originalLogLevel === undefined) {
      delete process.env['LOG_LEVEL']
    } else {
      process.env['LOG_LEVEL'] = originalLogLevel
    }
  })

  it('fails fast when retry is explicitly 0 and re-throws the original error', async () => {
    const boom = new Error('boom')
    const handler = vi.fn(async () => {
      throw boom
    })

    const runner = createDevRunner(
      [
        {
          id: 'fail-fast',
          params: {},
          handler,
        },
      ],
      { retry: 0 },
    )

    await expect(runner.start()).rejects.toBe(boom)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('defaults to 5 attempts when retry is not provided', async () => {
    const boom = new Error('boom')
    const handler = vi.fn(async () => {
      throw boom
    })

    const runner = createDevRunner([
      {
        id: 'default-retries',
        params: {},
        handler,
      },
    ])

    await expect(runner.start()).rejects.toBe(boom)
    expect(handler).toHaveBeenCalledTimes(5)
  })
})
