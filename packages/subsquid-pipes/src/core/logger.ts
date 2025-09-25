import pino, { Logger as PinoLogger } from 'pino'

export type Logger = PinoLogger

// FIXME 1) enable pretty-print only if TTY and process.env.LOG_PRETTY is not "false"
export function createDefaultLogger() {
  return pino({
    base: null,
    messageKey: 'message',
    level: process.env['LOG_LEVEL'] || 'info',
    formatters: {
      level(label) {
        return { level: label }
      },
    },
    serializers: {
      error: pino.stdSerializers.errWithCause,
      err: pino.stdSerializers.errWithCause,
    },
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        messageKey: 'message',
      },
    },
  })
}
