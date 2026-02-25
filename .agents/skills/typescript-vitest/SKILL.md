---
name: typescript-vitest
description: Use when writing tests, setting up test infrastructure, creating mocks, or configuring Vitest in TypeScript projects. Covers test organization, mocking patterns, assertions, and test utilities.
---

# Vitest Testing

Use **Vitest** as the test runner for all TypeScript projects.

## Setup

### Dependencies

```bash
npm install -D vitest @vitest/coverage-v8
```

### Configuration (`vitest.config.ts`)

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    maxConcurrency: 2,
    testTimeout: 20_000,
    slowTestThreshold: 10_000,
    bail: 1,
    coverage: {
      provider: 'v8',
    },
    expandSnapshotDiff: true,
  },
})
```

### With Path Aliases

If the project uses TypeScript path aliases (e.g., `~/`), add resolve:

```ts
import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '~': resolve(__dirname, 'src'),
    },
  },
  test: {
    // ...
  },
})
```

## Test File Organization

### Naming Convention

- Unit tests: `*.test.ts` — colocated next to the source file
- Integration/E2E tests: `*.e2e.test.ts` or placed in a `tests/` directory

### Directory Structure

```
src/
  feature/
    feature.ts
    feature.test.ts        # unit test next to source
  tests/
    mocks/                 # shared mock utilities
      mock-server.ts
      mock-data.ts
    helpers/               # test helpers
      setup.ts
    integration/           # integration tests
      api.e2e.test.ts
```

## Writing Tests

### Basic Structure

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

describe('FeatureName', () => {
  beforeEach(() => {
    // setup
  })

  afterEach(() => {
    // cleanup
  })

  it('should do expected behavior', () => {
    const result = doSomething()
    expect(result).toBe(expected)
  })

  it('should handle edge case', () => {
    expect(() => doSomething(badInput)).toThrow('Expected error message')
  })
})
```

### Test Naming

Use descriptive names that explain the behavior, not the implementation:

```ts
// Good
it('should return empty array when no items match filter')
it('should throw when connection string is invalid')
it('should retry failed requests up to 3 times')

// Bad
it('test filter')
it('error case')
it('works')
```

## Assertions

### Prefer Specific Matchers

```ts
// Equality
expect(value).toBe(exact)              // strict ===
expect(obj).toEqual(expected)          // deep equality
expect(obj).toMatchObject(partial)     // partial match

// Truthiness
expect(value).toBeTruthy()
expect(value).toBeFalsy()
expect(value).toBeNull()
expect(value).toBeUndefined()
expect(value).toBeDefined()

// Numbers
expect(value).toBeGreaterThan(3)
expect(value).toBeCloseTo(0.3, 5)

// Strings
expect(str).toContain('substring')
expect(str).toMatch(/regex/)

// Arrays
expect(arr).toHaveLength(3)
expect(arr).toContain(item)
expect(arr).toEqual(expect.arrayContaining([a, b]))

// Errors
expect(() => fn()).toThrow()
expect(() => fn()).toThrow('specific message')
expect(() => fn()).toThrow(CustomError)

// Async
await expect(asyncFn()).resolves.toBe(value)
await expect(asyncFn()).rejects.toThrow('error')
```

### Inline Snapshots

Use inline snapshots for complex output verification:

```ts
expect(formatOutput(data)).toMatchInlineSnapshot(`
  "expected output here"
`)
```

## Mocking

### Module Mocks

```ts
import { vi } from 'vitest'

// Mock entire module
vi.mock('./database', () => ({
  query: vi.fn().mockResolvedValue([]),
  connect: vi.fn(),
}))

// Mock with factory (auto-mocked)
vi.mock('./config')
```

### Function Spies

```ts
const spy = vi.fn()
spy.mockReturnValue(42)
spy.mockResolvedValue(data)
spy.mockImplementation((x) => x * 2)

expect(spy).toHaveBeenCalled()
expect(spy).toHaveBeenCalledWith('arg1', 'arg2')
expect(spy).toHaveBeenCalledTimes(3)
```

### Mock HTTP Server (Integration Tests)

For testing HTTP clients or APIs, create a mock server utility:

```ts
import { createServer, Server, IncomingMessage, ServerResponse } from 'http'

type MockResponse =
  | { statusCode: 200; body: unknown }
  | { statusCode: 204 }
  | { statusCode: 400 | 404 | 500 | 503; body?: unknown }

export function createMockServer(responses: MockResponse[]) {
  let callIndex = 0
  const calls: { method: string; url: string; body: string }[] = []

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const body = await readBody(req)
    calls.push({ method: req.method!, url: req.url!, body })

    const mock = responses[callIndex++]
    if (!mock) {
      res.writeHead(500)
      res.end('No more mock responses')
      return
    }

    res.writeHead(mock.statusCode, { 'Content-Type': 'application/json' })
    if ('body' in mock && mock.body !== undefined) {
      res.end(JSON.stringify(mock.body))
    } else {
      res.end()
    }
  })

  return {
    start: () => new Promise<string>((resolve) => {
      server.listen(0, () => {
        const addr = server.address() as { port: number }
        resolve(`http://localhost:${addr.port}`)
      })
    }),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    calls,
  }
}
```

### Timer Mocks

```ts
beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

it('should debounce calls', async () => {
  trigger()
  vi.advanceTimersByTime(500)
  expect(handler).toHaveBeenCalledTimes(1)
})
```

## Test Utilities

### Shared Setup

Create reusable test fixtures:

```ts
// tests/helpers/setup.ts
export function createTestContext() {
  const logger = pino({ level: 'silent' })
  const db = createTestDatabase()

  return {
    logger,
    db,
    async cleanup() {
      await db.close()
    },
  }
}
```

### Database Test Patterns

```ts
describe('UserRepository', () => {
  let ctx: TestContext

  beforeEach(async () => {
    ctx = await createTestContext()
  })

  afterEach(async () => {
    await ctx.cleanup()
  })

  it('should create user', async () => {
    const user = await ctx.db.users.create({ name: 'Test' })
    expect(user.id).toBeDefined()
  })
})
```

### Complex object testing 

Prefer inline snapshots for small but complex outputs, but for larger objects, use external snapshot files:

```ts
expect(formatData(data)).toMatchSnapshot('formatted-data')
```
or 
```ts
expect(formatData(data)).toMatchInlineSnapshot()
```


### Environment Variables in Tests

```ts
import { vi } from 'vitest'

beforeEach(() => {
  vi.stubEnv('DATABASE_URL', 'postgres://localhost:5432/test')
})

afterEach(() => {
  vi.unstubAllEnvs()
})
```

## Package.json Scripts

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage"
  }
}
```
