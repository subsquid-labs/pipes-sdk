import { arrayify } from '~/internal/array.js'

import { lines } from './formatters.js'

const DOCS_BASE = 'https://docs.sqd.dev/errors'

export enum SdkError {
  PipeConfiguration = 'PipeConfiguration',
  ForkHandling = 'ForkHandling',
}

export class PipeError extends Error {
  readonly code: string

  constructor(code: string, name: SdkError, message: string | string[]) {
    super(lines([...arrayify(message), '', `See: ${DOCS_BASE}/${code}`]))
    this.code = code
    this.name = name
  }
}

// ─── Target errors (E1xxx) ────────────────────────────────────────────────────

/**
 * E1001: Thrown when a fork is detected but the target does not implement fork handling.
 */
export class TargetForkNotSupportedError extends PipeError {
  constructor() {
    super('E1001', SdkError.ForkHandling, [
      'A blockchain fork was detected, but the target does not support fork handling.',
      'Implement the fork() method on your target to handle chain reorganizations.',
    ])
  }
}

/**
 * E1002: Thrown when a fork is detected but previousBlocks is empty (internal invariant violation).
 */
export class ForkNoPreviousBlocksError extends PipeError {
  constructor() {
    super('E1002', SdkError.ForkHandling, [
      'A blockchain fork was detected, but no previous blocks were provided.',
      'This is an internal error — please report it as a bug.',
    ])
  }
}

/**
 * E1003: Thrown when a fork is detected but the target fork() returned null.
 */
export class ForkCursorMissingError extends PipeError {
  constructor() {
    super('E1003', SdkError.ForkHandling, [
      'A blockchain fork was detected, but the target fork() did not return a new cursor.',
      'The fork() method must return the cursor to resume from after rolling back.',
    ])
  }
}
