---
name: typescript-pino-logger
description: Use when writing log statements, setting up logging, or creating logger instances in TypeScript projects. Covers Pino configuration, structured logging patterns, child loggers, request context, and error serialization.
---

# Pino Logger

Use **Pino** for logging in all TypeScript projects.

## Setup

### Dependencies

```bash
npm install pino pino-pretty
```

### Default Configuration

```ts
import pino from 'pino'

const logger = pino({
  base: undefined, // remove pid and hostname from logs
  level: process.env.LOG_LEVEL ?? 'info',
  messageKey: 'message',
  timestamp: pino.stdTimeFunctions.isoTime,
  serializers: {
    error: pino.stdSerializers.errWithCause,
  },
  transport:
    process.stdout?.isTTY
      ? {
          target: 'pino-pretty',
          options: {
            messageKey: 'message',
            singleLine: true,
          },
        }
      : undefined,
})
```

### Environment Variables

| Variable    | Purpose                           | Default                |
| ----------- | --------------------------------- | ---------------------- |
| `LOG_LEVEL` | Log level                         | `info`                 |
| `LOG_PRETTY`| Force pretty-printing on/off      | Auto-detect TTY        |

Use TTY detection for pretty-printing instead of `NODE_ENV`:
```ts
const pretty = process.stdout?.isTTY && !isEnvFalse('LOG_PRETTY')
```

## Usage

### Single-Object Logging

Log messages using a single object with a `message` field. Never use positional arguments.

**Do this:**
```ts
logger.info({
  message: 'User signed up',
  userId: '123',
})
```

**Not this:**
```ts
logger.info({ userId: '123' }, 'User signed up')
logger.info('User signed up')
```

### Error Logging

Include the error object under the `error` key:
```ts
logger.error({
  message: 'Failed to process payment',
  error,
  orderId: '456',
})
```

### Embed Context in the Message

Include important parameters directly in the message string for quick scanning.

**Do this:**
```ts
logger.warn({
  message: `ClickHouse data is stale for ${ageMinutes} mins, skipping tick`,
  latestTimestamp,
  thresholdMinutes: this.dataStalenessMs / 60_000,
})
```

**Not this:**
```ts
logger.warn({
  message: 'ClickHouse data is stale, skipping tick',
  ageMinutes,
})
```

### Human-Readable Units

Always log time and byte sizes in human-readable form.

```ts
logger.info({ message: `Processed batch in 1m 23s` })
logger.info({ message: `Payload size: 1.2 MB` })
```

Never:
```ts
logger.info({ message: `Processed in 83000ms` })
logger.info({ message: `Payload size: 1258291` })
```

## Child Loggers

Use child loggers to add persistent context within a scope:

```ts
const childLogger = logger.child({ requestId: req.id })
childLogger.info({ message: 'Processing request' })

// For pipeline/worker contexts
const pipeLogger = logger.child({ id: pipe.id })
```

## NestJS Integration

In NestJS apps, attach a logger to request context via middleware:

```ts
import { v4 as uuid } from 'uuid'

export function contextMiddleware(req: Request & { ctx: Context }, res: Response, next: NextFunction) {
  const requestId = req.header('x-request-id') || `gen-${uuid()}`

  req.ctx = new Context({
    req_id: requestId,
    req_user_ip: req.connection?.remoteAddress,
    req_user_agent: req.header('user-agent'),
    http_path: req.url,
    http_method: req.method,
  })

  res.header('X-Req-Id', requestId)
  next()
}
```

## Formatting Helpers

```ts
function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  if (bytes < 1024 ** 4) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  return `${(bytes / 1024 ** 4).toFixed(1)} TB`
}

function humanDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`

  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`

  const m = Math.floor(s / 60)
  const remainingS = s % 60
  if (m < 60) return remainingS > 0 ? `${m}m ${remainingS}s` : `${m}m`

  const h = Math.floor(m / 60)
  const remainingM = m % 60
  if (h < 24) return remainingM > 0 ? `${h}h ${remainingM}m` : `${h}h`

  const d = Math.floor(h / 24)
  const remainingH = h % 24
  return remainingH > 0 ? `${d}d ${remainingH}h` : `${d}d`
}
```
