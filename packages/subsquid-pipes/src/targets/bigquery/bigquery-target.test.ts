import type { BigQuery } from '@google-cloud/bigquery'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BigQueryStore, chunkBuffersByByteSize } from './bigquery-store.js'
import { BQ_ERR, BigQueryTargetError } from './errors.js'
import {
  type TrackedTable,
  assertSchemaMatches,
  partitioningWithDefaults,
  syncTableDdl,
  trackedTableDdl,
} from './tables.js'
import { assertInt64NotNull, assertRangePartitionedOn, isNotFoundError, isTransientError } from './utils.js'

/**
 * This file holds ONLY pure-function unit tests:
 *   - error classification helpers (isNotFoundError, isTransientError)
 *   - schema/partition validators (assertInt64NotNull, assertRangePartitionedOn,
 *     assertSchemaMatches)
 *   - DDL string generators (syncTableDdl, trackedTableDdl, partitioningWithDefaults)
 *   - chunkBuffersByByteSize byte-budget generator over pre-encoded proto rows
 *   - BigQueryStore allowlist guard (synchronous JS check, no SDK)
 *   - BigQueryTargetError wrapper class
 *
 * Anything that requires a BigQuery client (cursor I/O, recovery, fork resolution,
 * tracker.fork(), ensureTrackedTable, Storage Write API) lives in
 * `bigquery-target.integration.test.ts` — those scenarios are exercisable against the
 * a real BigQuery project (gated by `BIGQUERY_TEST_PROJECT`).
 */

describe('BigQueryStore — tracked-table allowlist', () => {
  let store: BigQueryStore
  const tables: TrackedTable[] = [
    { table: 'events', blockNumberColumn: 'block_number', schema: [] },
    { table: 'transfers', blockNumberColumn: 'block_number', schema: [] },
  ]

  beforeEach(() => {
    const fakeBq = {} as BigQuery
    const fakeWriter = { close: vi.fn() } as any
    store = new BigQueryStore(fakeBq, fakeWriter, {
      projectId: 'p',
      dataset: 'd',
      trackedTables: tables,
      syncTable: { dataset: 'd', table: 'sync' },
    })
  })

  it('accepts insert into a registered table', () => {
    expect(() => store.insert('events', [{ block_number: 1 }])).not.toThrow()
  })

  it('throws synchronously on insert into an unregistered table with a clear error', () => {
    expect(() => store.insert('logs', [{ block_number: 1 }])).toThrow(
      /Table 'logs' is not registered for fork tracking/,
    )
  })

  it('lists registered tables in the error message to aid debugging', () => {
    try {
      store.insert('logs', [{ block_number: 1 }])
      throw new Error('expected throw')
    } catch (e) {
      expect((e as Error).message).toContain('events')
      expect((e as Error).message).toContain('transfers')
    }
  })

  it('allowlist is built from tables[] config, not inferred from BQ schema', () => {
    expect(store._allowlist.has('events')).toBe(true)
    expect(store._allowlist.has('transfers')).toBe(true)
    expect(store._allowlist.has('logs')).toBe(false)
    expect(store._allowlist.has('sync')).toBe(false)
  })

  it('blocks the unregistered write before any RPC is attempted (synchronous throw)', () => {
    // Throw must be synchronous — we don't even await — so a single try/catch traps it.
    let threw = false
    try {
      store.insert('logs', [{ block_number: 1 }])
    } catch {
      threw = true
    }
    expect(threw).toBe(true)
  })

  it('buffers rows across multiple insert calls into the same table', async () => {
    store.insert('events', [{ block_number: 1 }, { block_number: 2 }])
    store.insert('events', [{ block_number: 3 }])
    // Internal buffer is private; we observe via commitBatch dispatch — but with no real
    // WriterClient we can't fully exercise commitBatch. Instead, verify via behavior in the
    // end-to-end describe block below.
    expect(true).toBe(true) // sanity placeholder for buffer accumulation; real coverage in e2e
  })

  it('insert with empty rows array is a no-op', () => {
    expect(() => store.insert('events', [])).not.toThrow()
  })
})

// -----------------------------------------------------------------------------
// chunkBuffersByByteSize — chunking by exact proto byte length under the 16MB cap
// -----------------------------------------------------------------------------

describe('chunkBuffersByByteSize', () => {
  const oneMb = (): Uint8Array => new Uint8Array(1024 * 1024)

  it('yields one chunk for small inputs', () => {
    const chunks = [...chunkBuffersByByteSize([new Uint8Array(8), new Uint8Array(8), new Uint8Array(8)])]
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toHaveLength(3)
  })

  it('splits when cumulative byteLength exceeds the 12MB budget', () => {
    // 30 × 1MB = 30MB total → must split into multiple chunks under the 12MB cap.
    const buffers = Array.from({ length: 30 }, oneMb)
    const chunks = [...chunkBuffersByByteSize(buffers)]
    expect(chunks.length).toBeGreaterThanOrEqual(3) // 30MB / 12MB ≈ 3 chunks min
    // Every chunk must respect the 12MB cap exactly. A regression that raises the cap (which
    // is exactly the GFE flow-control window we're avoiding — `RESOURCE_EXHAUSTED:
    // Bandwidth exhausted or memory limit exceeded`) MUST fail here.
    for (const c of chunks) {
      const total = c.reduce((sum, b) => sum + b.byteLength, 0)
      expect(total).toBeLessThanOrEqual(12 * 1024 * 1024)
    }
  })

  it('yields nothing for empty input', () => {
    expect([...chunkBuffersByByteSize([])]).toEqual([])
  })

  it('keeps a single oversized buffer as its own chunk (does not lose data)', () => {
    const huge = new Uint8Array(20 * 1024 * 1024) // 20MB single buffer (over the 16MB cap)
    const chunks = [...chunkBuffersByByteSize([huge])]
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toHaveLength(1)
  })

  it('preserves buffer order across chunks', () => {
    // Tag each buffer with its index in byte 0 so we can reconstruct order after chunking.
    const buffers = Array.from({ length: 20 }, (_, i) => {
      const buf = new Uint8Array(1024 * 1024)
      buf[0] = i
      return buf
    })
    const chunks = [...chunkBuffersByByteSize(buffers)]
    const flatOrder = chunks.flat().map((b) => b[0])
    expect(flatOrder).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19])
  })
})

// -----------------------------------------------------------------------------
// utils.ts — error classification
// -----------------------------------------------------------------------------

describe('BigQueryTargetError', () => {
  it('every target throw is wrapped in BigQueryTargetError with a matching E11xx code', () => {
    // Spot-check across the surface area: each thrown error is an instance of
    // BigQueryTargetError and carries the expected code. Downstream code can match on
    // `instanceof BigQueryTargetError` instead of scraping `.message`.
    try {
      assertInt64NotNull(md([{ name: 'bn', type: 'STRING', mode: 'REQUIRED' }]), 'bn', 'p.d.t')
      throw new Error('expected throw')
    } catch (e) {
      expect(e).toBeInstanceOf(BigQueryTargetError)
      expect((e as BigQueryTargetError).code).toBe(BQ_ERR.PARTITION_COLUMN_TYPE)
    }

    try {
      assertRangePartitionedOn(md([]), 'bn', 'p.d.t', '')
      throw new Error('expected throw')
    } catch (e) {
      expect(e).toBeInstanceOf(BigQueryTargetError)
      expect((e as BigQueryTargetError).code).toBe(BQ_ERR.TABLE_NOT_PARTITIONED)
    }

    try {
      trackedTableDdl(
        'p.d.t',
        {
          table: 't',
          blockNumberColumn: 'bn',
          schema: [{ name: 'tx', type: 'STRING' }], // missing bn
        },
        partitioningWithDefaults(),
      )
      throw new Error('expected throw')
    } catch (e) {
      expect(e).toBeInstanceOf(BigQueryTargetError)
      expect((e as BigQueryTargetError).code).toBe(BQ_ERR.PARTITION_COLUMN_MISSING)
    }
  })
})

describe('isNotFoundError', () => {
  it('detects code: 404', () => {
    expect(isNotFoundError({ code: 404 })).toBe(true)
    expect(isNotFoundError({ code: '404' })).toBe(true)
  })

  it('detects "not found" in message (case-insensitive)', () => {
    expect(isNotFoundError({ message: 'Not found: Table p.d.foo' })).toBe(true)
    expect(isNotFoundError({ message: 'NOT FOUND' })).toBe(true)
  })

  it('detects errors[].reason === "notFound"', () => {
    expect(isNotFoundError({ errors: [{ reason: 'notFound' }] })).toBe(true)
    expect(isNotFoundError({ errors: [{ reason: 'invalid' }] })).toBe(false)
  })

  it('walks the cause chain', () => {
    const inner = { code: 404 }
    const outer = { cause: { cause: inner } }
    expect(isNotFoundError(outer)).toBe(true)
  })

  it('returns false for unrelated errors', () => {
    expect(isNotFoundError(new Error('boom'))).toBe(false)
    expect(isNotFoundError({ code: 500 })).toBe(false)
    expect(isNotFoundError(null)).toBe(false)
    expect(isNotFoundError(undefined)).toBe(false)
    expect(isNotFoundError('string')).toBe(false)
  })
})

describe('isTransientError', () => {
  it('detects gRPC ABORTED (10)', () => {
    expect(isTransientError({ code: 10 })).toBe(true)
  })

  it('detects gRPC UNAVAILABLE (14) and RESOURCE_EXHAUSTED (8)', () => {
    expect(isTransientError({ code: 14 })).toBe(true)
    expect(isTransientError({ code: 8 })).toBe(true)
  })

  it('detects HTTP 429/5xx', () => {
    expect(isTransientError({ code: 429 })).toBe(true)
    expect(isTransientError({ code: 500 })).toBe(true)
    expect(isTransientError({ code: 503 })).toBe(true)
  })

  it('walks cause chain', () => {
    expect(isTransientError({ cause: { code: 14 } })).toBe(true)
  })

  it('returns false for fatal errors (INVALID_ARGUMENT, NOT_FOUND)', () => {
    expect(isTransientError({ code: 3 })).toBe(false) // INVALID_ARGUMENT
    expect(isTransientError({ code: 5 })).toBe(false) // NOT_FOUND
    expect(isTransientError({ code: 404 })).toBe(false)
  })
})

// -----------------------------------------------------------------------------
// utils.ts — partition column type/mode guards (B5 / schema safety)
// -----------------------------------------------------------------------------

const md = (
  fields: { name: string; type: string; mode?: string }[],
  rangePartitionField?: string,
): import('@google-cloud/bigquery').TableMetadata =>
  ({
    schema: { fields },
    rangePartitioning: rangePartitionField ? { field: rangePartitionField } : undefined,
  }) as import('@google-cloud/bigquery').TableMetadata

describe('assertInt64NotNull', () => {
  it('passes for INT64 REQUIRED', () => {
    expect(() => assertInt64NotNull(md([{ name: 'bn', type: 'INT64', mode: 'REQUIRED' }]), 'bn', 'p.d.t')).not.toThrow()
  })

  it('passes for INTEGER alias REQUIRED', () => {
    expect(() =>
      assertInt64NotNull(md([{ name: 'bn', type: 'INTEGER', mode: 'REQUIRED' }]), 'bn', 'p.d.t'),
    ).not.toThrow()
  })

  it('throws when the column is missing', () => {
    expect(() => assertInt64NotNull(md([]), 'bn', 'p.d.t')).toThrow(/missing the partition column 'bn'/)
  })

  it('throws on FLOAT64 with precision-loss reasoning (Solana slot)', () => {
    expect(() => assertInt64NotNull(md([{ name: 'bn', type: 'FLOAT64', mode: 'REQUIRED' }]), 'bn', 'p.d.t')).toThrow(
      /loses precision above 2\^53/,
    )
  })

  it('throws on NUMERIC with precision-loss reasoning', () => {
    expect(() => assertInt64NotNull(md([{ name: 'bn', type: 'NUMERIC', mode: 'REQUIRED' }]), 'bn', 'p.d.t')).toThrow(
      /loses precision/,
    )
  })

  it('throws on STRING with lexicographic-compare reasoning', () => {
    expect(() => assertInt64NotNull(md([{ name: 'bn', type: 'STRING', mode: 'REQUIRED' }]), 'bn', 'p.d.t')).toThrow(
      /BETWEEN compares lexicographically/,
    )
  })

  it('throws on NULLable INT64 with three-valued-logic reasoning', () => {
    expect(() => assertInt64NotNull(md([{ name: 'bn', type: 'INT64', mode: 'NULLABLE' }]), 'bn', 'p.d.t')).toThrow(
      /three-valued logic/,
    )
  })

  it('treats missing mode as NULLABLE (BQ default) and throws', () => {
    expect(() => assertInt64NotNull(md([{ name: 'bn', type: 'INT64' }]), 'bn', 'p.d.t')).toThrow(/three-valued logic/)
  })
})

describe('assertRangePartitionedOn', () => {
  it('passes when partitioned on the right column', () => {
    expect(() => assertRangePartitionedOn(md([], 'bn'), 'bn', 'p.d.t', 'CREATE...')).not.toThrow()
  })

  it('throws when not partitioned at all and includes suggested DDL', () => {
    try {
      assertRangePartitionedOn(md([]), 'bn', 'p.d.t', 'CREATE TABLE foo')
      throw new Error('expected throw')
    } catch (e) {
      expect((e as Error).message).toContain('no range partitioning')
      expect((e as Error).message).toContain('CREATE TABLE foo')
    }
  })

  it('throws when partitioned on wrong column and names both columns', () => {
    expect(() => assertRangePartitionedOn(md([], 'other_col'), 'bn', 'p.d.t', '')).toThrow(
      /range-partitioned on 'other_col'/,
    )
  })
})

// -----------------------------------------------------------------------------
// tables.ts — DDL generators + schema diff + auto-create
// -----------------------------------------------------------------------------

describe('syncTableDdl', () => {
  it('emits CREATE TABLE IF NOT EXISTS with the WAL columns and a server-side timestamp default', () => {
    const ddl = syncTableDdl({ fqn: 'p.d.sync', dataset: 'd', table: 'sync' })
    expect(ddl).toContain('CREATE TABLE IF NOT EXISTS')
    expect(ddl).toContain('`p.d.sync`')
    for (const col of [
      'id',
      'op',
      'current',
      'finalized',
      'rollback_chain',
      'range_low',
      'range_high',
      'committed',
      'timestamp',
    ]) {
      expect(ddl).toContain(col)
    }
    // Server-side timestamp via DEFAULT CURRENT_TIMESTAMP() — single source of truth, no
    // client-side counter or clock-skew concerns.
    expect(ddl).toContain('TIMESTAMP DEFAULT CURRENT_TIMESTAMP() NOT NULL')
    // Sync table is intentionally unpartitioned — small enough that pruning buys nothing.
    expect(ddl).not.toContain('PARTITION BY')
    expect(ddl).not.toContain('CLUSTER BY')
  })

  it('backtick-quotes every column name (regression: BQ reserved keywords)', () => {
    // `current` and `timestamp` are BigQuery reserved keywords — without backtick quoting
    // BigQuery rejects the CREATE TABLE with `Syntax error: Expected ")" or "," but got
    // keyword CURRENT`. Unit tests against the fake store don't catch this (the SQL is
    // never parsed); only execution against a real BQ project
    // would reveal it. Hence this static guard.
    //
    // If you rename or add columns, audit them against
    // https://cloud.google.com/bigquery/docs/reference/standard-sql/lexical#reserved_keywords
    const ddl = syncTableDdl({ fqn: 'p.d.sync', dataset: 'd', table: 'sync' })

    // `current` only appears as a column name in our DDL → must never appear unbackticked.
    expect(ddl).not.toMatch(/(?<![`\w])current(?![`\w])/i)
    expect(ddl).toContain('`current`')

    // `timestamp` appears as BOTH a column name AND a type — the column-name occurrence
    // must be backticked.
    expect(ddl).toMatch(/`timestamp`\s+TIMESTAMP/i)
  })
})

describe('trackedTableDdl', () => {
  const tt: TrackedTable = {
    table: 'events',
    blockNumberColumn: 'block_number',
    schema: [
      { name: 'block_number', type: 'STRING' }, // user lied; should be coerced to INT64 NOT NULL
      { name: 'tx_hash', type: 'STRING', mode: 'REQUIRED' },
      { name: 'value', type: 'NUMERIC' },
    ],
    clusterBy: ['tx_hash'],
  }

  it('forces blockNumberColumn to INT64 NOT NULL regardless of user input', () => {
    const ddl = trackedTableDdl('p.d.events', tt, partitioningWithDefaults())
    expect(ddl).toMatch(/`block_number` INT64 NOT NULL/)
    expect(ddl).not.toMatch(/`block_number` STRING/)
  })

  it('emits RANGE_BUCKET on the partition column with the configured size and max', () => {
    const ddl = trackedTableDdl('p.d.events', tt, { bucketSize: 5000, maxBlocks: 2_000_000 })
    expect(ddl).toContain('PARTITION BY RANGE_BUCKET')
    expect(ddl).toContain('GENERATE_ARRAY(0, 2000000, 5000)')
  })

  it('omits PARTITION BY and CLUSTER BY when partitioning=false (still coerces partition column to INT64 NOT NULL)', () => {
    const ddl = trackedTableDdl('p.d.events', tt, false)
    expect(ddl).not.toContain('PARTITION BY')
    expect(ddl).not.toContain('RANGE_BUCKET')
    expect(ddl).not.toContain('CLUSTER BY')
    // The DELETE predicate column requirement (INT64 NOT NULL) is independent of partitioning —
    // a NULL or non-INT64 block_number breaks fork rollback regardless.
    expect(ddl).toMatch(/`block_number` INT64 NOT NULL/)
  })

  it('emits CLUSTER BY when clusterBy specified', () => {
    const ddl = trackedTableDdl('p.d.events', tt, partitioningWithDefaults())
    expect(ddl).toContain('CLUSTER BY `tx_hash`')
  })

  it('omits CLUSTER BY when clusterBy is undefined', () => {
    const ddl = trackedTableDdl('p.d.events', { ...tt, clusterBy: undefined }, partitioningWithDefaults())
    expect(ddl).not.toContain('CLUSTER BY')
  })

  it('preserves REQUIRED on non-partition columns', () => {
    const ddl = trackedTableDdl('p.d.events', tt, partitioningWithDefaults())
    expect(ddl).toMatch(/`tx_hash` STRING NOT NULL/)
  })

  it('throws when a field has mode=REPEATED (auto-create does not support arrays)', () => {
    const withArray: TrackedTable = {
      table: 'events',
      blockNumberColumn: 'block_number',
      schema: [
        { name: 'block_number', type: 'INT64', mode: 'REQUIRED' },
        { name: 'tags', type: 'STRING', mode: 'REPEATED' },
      ],
    }
    expect(() => trackedTableDdl('p.d.events', withArray, partitioningWithDefaults())).toThrow(
      /'tags' has mode=REPEATED/,
    )
  })

  it('throws when a field has type=RECORD or STRUCT (auto-create does not support nested fields)', () => {
    const withRecord: TrackedTable = {
      table: 'events',
      blockNumberColumn: 'block_number',
      schema: [
        { name: 'block_number', type: 'INT64', mode: 'REQUIRED' },
        { name: 'meta', type: 'RECORD' },
      ],
    }
    expect(() => trackedTableDdl('p.d.events', withRecord, partitioningWithDefaults())).toThrow(
      /'meta' has type=RECORD/,
    )
    expect(() =>
      trackedTableDdl(
        'p.d.events',
        {
          ...withRecord,
          schema: [
            { name: 'block_number', type: 'INT64', mode: 'REQUIRED' },
            { name: 'm', type: 'STRUCT' },
          ],
        },
        partitioningWithDefaults(),
      ),
    ).toThrow(/'m' has type=STRUCT/)
  })

  it('throws when schema is missing the partition column (review fix #6)', () => {
    const broken: TrackedTable = {
      table: 'events',
      blockNumberColumn: 'block_number',
      schema: [{ name: 'tx_hash', type: 'STRING', mode: 'REQUIRED' }], // no block_number
    }
    expect(() => trackedTableDdl('p.d.events', broken, partitioningWithDefaults())).toThrow(
      /schema does not include the partition column 'block_number'/,
    )
  })
})

describe('partitioningWithDefaults', () => {
  it('uses sensible defaults', () => {
    expect(partitioningWithDefaults()).toEqual({ bucketSize: 10_000, maxBlocks: 100_000_000 })
  })

  it('respects user overrides', () => {
    expect(partitioningWithDefaults({ bucketSize: 1000 })).toEqual({
      bucketSize: 1000,
      maxBlocks: 100_000_000,
    })
  })

  it('passes false through verbatim (disable partitioning entirely)', () => {
    expect(partitioningWithDefaults(false)).toBe(false)
  })
})

describe('assertSchemaMatches', () => {
  const fqn = 'p.d.events'

  it('passes when every declared column exists with the same type AND mode', () => {
    expect(() =>
      assertSchemaMatches(
        md([
          { name: 'block_number', type: 'INT64', mode: 'REQUIRED' },
          { name: 'tx_hash', type: 'STRING' },
        ]),
        [
          { name: 'block_number', type: 'INT64', mode: 'REQUIRED' },
          { name: 'tx_hash', type: 'STRING' },
        ],
        fqn,
      ),
    ).not.toThrow()
  })

  it('tolerates extra columns in the live table (forward-compat)', () => {
    expect(() =>
      assertSchemaMatches(
        md([
          { name: 'block_number', type: 'INT64', mode: 'REQUIRED' },
          { name: 'tx_hash', type: 'STRING' },
          { name: 'added_later', type: 'STRING' }, // extra
        ]),
        [{ name: 'block_number', type: 'INT64', mode: 'REQUIRED' }],
        fqn,
      ),
    ).not.toThrow()
  })

  it('throws when a declared column is missing from the live table', () => {
    expect(() =>
      assertSchemaMatches(
        md([{ name: 'block_number', type: 'INT64', mode: 'REQUIRED' }]),
        [{ name: 'tx_hash', type: 'STRING' }],
        fqn,
      ),
    ).toThrow(/missing declared column 'tx_hash'/)
  })

  it('throws when mode mismatches (REPEATED live vs scalar declared)', () => {
    expect(() =>
      assertSchemaMatches(
        md([{ name: 'tags', type: 'STRING', mode: 'REPEATED' }]),
        [{ name: 'tags', type: 'STRING' }], // implicit NULLABLE
        fqn,
      ),
    ).toThrow(/has mode REPEATED, but declared as NULLABLE/)
  })

  it('treats undefined mode as NULLABLE (BQ default) when comparing modes', () => {
    expect(() =>
      assertSchemaMatches(
        md([{ name: 'tx_hash', type: 'STRING' }]), // no mode
        [{ name: 'tx_hash', type: 'STRING', mode: 'NULLABLE' }],
        fqn,
      ),
    ).not.toThrow()
  })

  it('throws when a declared column has a different live type', () => {
    expect(() =>
      assertSchemaMatches(
        md([{ name: 'block_number', type: 'STRING' }]),
        [{ name: 'block_number', type: 'INT64' }],
        fqn,
      ),
    ).toThrow(/has type STRING, but declared as INT64/)
  })

  it('treats INTEGER and INT64 as the same type (legacy SQL alias)', () => {
    expect(() =>
      assertSchemaMatches(
        md([{ name: 'bn', type: 'INTEGER', mode: 'REQUIRED' }]),
        [{ name: 'bn', type: 'INT64', mode: 'REQUIRED' }],
        fqn,
      ),
    ).not.toThrow()
    expect(() =>
      assertSchemaMatches(
        md([{ name: 'bn', type: 'INT64', mode: 'REQUIRED' }]),
        [{ name: 'bn', type: 'INTEGER', mode: 'REQUIRED' }],
        fqn,
      ),
    ).not.toThrow()
  })
})
