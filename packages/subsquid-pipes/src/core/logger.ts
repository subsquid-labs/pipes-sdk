import pino, { Logger as PinoLogger } from 'pino'

export type Logger = PinoLogger
export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent' | false | null

function isEnvFalse(name: string): boolean {
  const val = process.env[name]

  return val === 'false' || val === '0'
}

export function createDefaultLogger({ id, level }: { level?: LogLevel; id?: string } = {}): Logger {
  const baseLevel = level !== false && level !== null ? level : 'silent'

  const pretty = process.stdout?.isTTY && !isEnvFalse('LOG_PRETTY')

  return pino({
    base: id ? { id } : undefined,
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
    transport: pretty
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            singleLine: true,
            colorizeObjects: 'dim',
            ignore: 'id',
            messageKey: 'message',
            messageFormat: '\x1B[0m\x1b[2m{id}\x1B[0m {message}',
            quote: false,
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
