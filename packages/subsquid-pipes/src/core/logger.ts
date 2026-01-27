import pino, { Logger as PinoLogger } from 'pino'

export type Logger = PinoLogger
export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent' | false | null

function isEnvFalse(name: string): boolean {
  const val = process.env[name]

  return val === 'false' || val === '0'
}

export function createDefaultLogger({ level }: { level?: LogLevel } = {}): Logger {
  const baseLevel = level !== false && level !== null ? level : 'silent'

  return pino({
    base: null,
    messageKey: 'message',
    level: baseLevel ?? (process.env['LOG_LEVEL'] || 'info'),
    formatters: {
      level(label) {
        return { level: label }
      },
    },
    serializers: {
      error: pino.stdSerializers.errWithCause,
      err: pino.stdSerializers.errWithCause,
    },
    transport:
      process.stdout?.isTTY && !isEnvFalse('LOG_PRETTY')
        ? {
            target: 'pino-pretty',
            options: {
              colorize: true,
              messageKey: 'message',
            },
          }
        : undefined,
  })
}

export function formatWarning({ title, content }: { content: string | string[]; title: string }): string {
  return `
==================================================================
⚠️  ${title.trim()}
------------------------------------------------------------------

${Array.isArray(content) ? content.join('\n').trim() : content.trim()}
==================================================================
`
}
