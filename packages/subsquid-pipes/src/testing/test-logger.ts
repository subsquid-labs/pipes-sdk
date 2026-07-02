import { pino, stdSerializers } from 'pino'

export function createTestLogger() {
  return pino({
    level: process.env['LOG_LEVEL'] || 'info',
    messageKey: 'message',
    serializers: {
      error: stdSerializers.errWithCause,
      err: stdSerializers.errWithCause,
    },
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        messageKey: 'message',
        singleLine: true,
      },
    },

    base: {},
  })
}
