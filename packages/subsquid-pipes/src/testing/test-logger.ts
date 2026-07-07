import { pino, stdSerializers } from 'pino'

export type TestLoggerOptions = {
  /** Receives every log entry as a parsed object instead of writing to stdout */
  capture?: (entry: Record<string, any>) => void
}

export function createTestLogger({ capture }: TestLoggerOptions = {}) {
  const options = {
    level: process.env['LOG_LEVEL'] || 'info',
    messageKey: 'message',
    serializers: {
      error: stdSerializers.errWithCause,
      err: stdSerializers.errWithCause,
    },
    base: {},
  }

  if (capture) {
    return pino(options, { write: (line: string) => capture(JSON.parse(line)) })
  }

  return pino({
    ...options,
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        messageKey: 'message',
        singleLine: true,
      },
    },
  })
}
