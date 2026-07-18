import { describe, expect, it, vi } from 'vitest'

import { benchLogger } from './logger.js'

describe('benchLogger', () => {
  it('logs at warn level and never writes to stdout', () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    try {
      const logger = benchLogger('bench-test')

      expect(logger.level).toBe('warn')

      logger.warn('diagnostic that must not pollute the metrics line')
      logger.error('same for errors')

      expect(stdout).not.toHaveBeenCalled()
    } finally {
      stdout.mockRestore()
    }
  })
})
