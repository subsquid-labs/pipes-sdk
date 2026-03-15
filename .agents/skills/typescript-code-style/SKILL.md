---
name: typescript-code-style
description: Use when writing TypeScript code in any project. Covers naming conventions, file organization, error handling, configuration patterns, TypeScript compiler settings, and general code approaches. Apply these conventions by default.
---

# TypeScript Code Style

General conventions for all TypeScript projects. Apply these by default.

## TypeScript Configuration

### tsconfig.json

```json
{
  "compilerOptions": {
    "target": "esnext",
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "strict": true,
    "noImplicitReturns": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "sourceMap": true,
    "outDir": "dist",
    "stripInternal": true
  }
}
```

Key points:
- Always enable `strict: true`
- Use `nodenext` module resolution for Node.js projects
- Use `stripInternal: true` with `@internal` JSDoc to hide implementation details from declaration files

### Path Aliases

```json
{
  "compilerOptions": {
    "paths": {
      "~/*": ["src/*"]
    }
  }
}
```

Use `~/` prefix for internal imports. Never use relative paths that go up more than one level (`../../`).

## Naming Conventions

| Element              | Convention        | Example                       |
| -------------------- | ----------------- | ----------------------------- |
| Files                | kebab-case        | `user-service.ts`             |
| Classes              | PascalCase        | `UserService`                 |
| Interfaces/Types     | PascalCase        | `UserSession`                 |
| Functions/Methods    | camelCase         | `findByEmail()`               |
| Constants            | UPPER_SNAKE_CASE  | `MAX_RETRY_COUNT`             |
| Private class fields | `#` prefix        | `#connection`                 |
| Enum values          | PascalCase        | `Status.Active`               |
| Boolean variables    | is/has/can prefix | `isActive`, `hasPermission`   |

### File Naming

```
user.service.ts          # service
user.controller.ts       # controller
user.repository.ts       # repository
user.entity.ts           # database entity
user.test.ts             # test
user.e2e.test.ts         # e2e test
create-user.request.ts   # request DTO
user.response.ts         # response DTO
index.ts                 # barrel exports
```

## Exports

### Barrel Files

Use `index.ts` for public API of a module:

```ts
export * from './user.service'
export * from './user.entity'
export type { UserSession } from './user.types'
```

### Export Patterns

- Use `export type` for type-only exports
- Mark internal implementation with `@internal` JSDoc
- Prefer named exports over default exports

```ts
/** @internal */
export function internalHelper() {}

export type UserRole = 'admin' | 'user' | 'viewer'

export class UserService {}
```

## Error Handling

### Custom Error Classes

Create specific error types with type guards:

```ts
export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export class ForkException extends Error {
  readonly name = 'ForkError'
  readonly previousBlocks: BlockCursor[]

  constructor(previousBlocks: BlockCursor[]) {
    super(`Fork detected at block ${previousBlocks[0]?.number}`)
    this.previousBlocks = previousBlocks
  }
}

export function isForkException(err: unknown): err is ForkException {
  return err instanceof ForkException || (err instanceof Error && err.name === 'ForkError')
}
```

### Error Handling Rules

1. **Use type guards** for error discrimination — check both `instanceof` and `name` for cross-boundary errors
2. **Serialize errors with cause chains** in logging using `pino.stdSerializers.errWithCause`
3. **Wrap unknown errors** with `ensureError()` before propagating:
   ```ts
   function ensureError(value: unknown): Error {
     if (value instanceof Error) return value
     return new Error(String(value))
   }
   ```
4. **Never silently swallow errors** — at minimum, log them
5. **Use specific error classes** — not generic `Error` for domain errors

## Configuration

### Environment Variables

Use environment variables for all configuration. Validate at startup:

```ts
const config = {
  port: Number(process.env.HTTP_PORT ?? 3000),
  logLevel: process.env.LOG_LEVEL ?? 'info',
  databaseUrl: requireEnv('DATABASE_URL'),
}

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required env var: ${name}`)
  return value
}
```

### Options Objects

Use options objects for component configuration with sensible defaults:

```ts
interface HttpClientOptions {
  baseUrl: string
  timeout?: number        // default: 20_000
  retryAttempts?: number  // default: 3
  retrySchedule?: number[] // default: [1000, 3000, 10_000]
  headers?: Record<string, string>
}
```

## Code Patterns

### Prefer `#private` Over `private`

Use ES private fields for true encapsulation:

```ts
class Connection {
  #client: Client
  #logger: Logger

  constructor(client: Client, logger: Logger) {
    this.#client = client
    this.#logger = logger
  }
}
```

### Numeric Literals

Use underscores for readability:

```ts
const MAX_SIZE = 10_485_760   // 10 MB
const TIMEOUT = 5_000         // 5 seconds
const IDLE_TIME = 300         // 300ms
```

### Async Patterns

- Always handle promises — use `@typescript-eslint/no-floating-promises`
- Use `AsyncLocalStorage` for implicit context passing in pipelines:
  ```ts
  import { AsyncLocalStorage } from 'node:async_hooks'

  const asyncLocalStorage = new AsyncLocalStorage<RuntimeContext>()

  export function runWithContext<T>(ctx: RuntimeContext, fn: () => Promise<T>): Promise<T> {
    return asyncLocalStorage.run(ctx, fn)
  }

  export function useContext(): RuntimeContext {
    const ctx = asyncLocalStorage.getStore()
    if (!ctx) throw new Error('No runtime context')
    return ctx
  }
  ```

### Composition Over Inheritance

Use composable transformers/middleware instead of deep class hierarchies:

```ts
// Good: composable pipeline
const pipeline = source
  .pipe(decode())
  .pipe(transform())
  .pipe(filter())

// Bad: deep inheritance
class SpecializedTransformer extends BaseTransformer extends AbstractTransformer {}
```

### Builder Pattern for Complex Configuration

```ts
const query = evmQueryBuilder()
  .addFields({ logs: { address: true, topics: true } })
  .setRange({ from: 1_000_000 })
  .build()
```

### Factory Functions Over Constructors

Prefer factory functions when the construction logic is complex or return types vary:

```ts
// Good
export function createLogger(options?: LoggerOptions): Logger {
  return pino({ ...defaults, ...options })
}

// Instead of exposing constructor directly
```

## Build Setup

### tsup (for Libraries)

```ts
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'dist',
  format: ['cjs', 'esm'],
  sourcemap: true,
  dts: true,
  clean: true,
})
```

### Package.json Exports (Dual CJS/ESM)

```json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    }
  }
}
```

## Things to Avoid

1. **No `namespace`** — use ES modules
2. **No `enum`** — use `as const` objects or union types:
   ```ts
   // Good
   const Status = { Active: 'active', Inactive: 'inactive' } as const
   type Status = (typeof Status)[keyof typeof Status]

   // Bad
   enum Status { Active = 'active', Inactive = 'inactive' }
   ```
3. **No `any` in public APIs** — use `unknown` and narrow
4. **No `==`** — always `===`
5. **No default exports** — use named exports
6. **No relative imports beyond one level** — use path aliases (`~/`)
7. **No magic numbers** — extract to named constants
8. **No classes for simple data** — use plain objects and types
