<!--
  Single source of truth for @subsquid/pipes error codes.

  Every SDK error ends its message with
  `See: https://docs.sqd.dev/en/sdk/pipes-sdk/errors/<code>`.
  The docs site imports THIS file and serves it at /en/sdk/pipes-sdk/errors,
  routing /en/sdk/pipes-sdk/errors/<code> to the matching section anchor below.

  Keep in sync with the code the messages come from:
    - packages/subsquid-pipes/src/core/errors.ts                          (E0xxx, E1xxx)
    - packages/subsquid-pipes/src/targets/clickhouse/errors.ts            (E20xx)
    - packages/subsquid-pipes/src/targets/drizzle/node-postgres/errors.ts (E21xx)
    - packages/subsquid-pipes/src/targets/bigquery/errors.ts              (E22xx)
    - packages/subsquid-pipes/src/targets/parquet/errors.ts               (E23xx)
-->

# Error reference

Every error `@subsquid/pipes` raises carries a stable code and ends its message with a link back to
this page:

```
Pipe requires a non-default ID when used with targets.
...
See: https://docs.sqd.dev/en/sdk/pipes-sdk/errors/E0001
```

Match on the code (or the `instanceof` class), not the message text — messages may be reworded, codes
are stable. Codes are grouped by where they originate:

| Prefix  | Area                        |
| ------- | --------------------------- |
| `E0xxx` | Source / pipe configuration |
| `E1xxx` | Fork handling & rollback    |
| `E20xx` | ClickHouse target           |
| `E21xx` | Postgres (Drizzle) target   |
| `E22xx` | BigQuery target             |
| `E23xx` | Parquet target              |

---

## Pipe configuration

### E0001 · Pipe requires a unique id

A pipe was connected to a target (`.pipeTo(...)`) while still using the default id. Targets persist
their resume cursor under the pipe's `id`, so a shared/default id would let two pipes silently
overwrite each other's progress.

**Fix** — set a stable, globally unique, non-empty `id`:

```ts
evmPortalStream({ id: 'eth-transfers', portal: '...', outputs })
```

### E0002 · Invalid block range

A `range` (on the stream or a decoder) is misconfigured — an inverted range (`from` after `to`), an
invalid date, or a timestamp that can't be resolved to a block. The message names the exact problem.

**Fix** — ensure `from ≤ to` and use a resolvable bound: `'latest'`, a block number (`'12,000,000'`),
an ISO date (`'2024-01-01'`), or a `Date`.

---

## Fork handling

Raised while unwinding a chain reorganization (fork). The built-in targets handle forks; the first
three mostly surface in **custom** targets.

### E1001 · Target does not support fork handling

A fork was detected, but the target does not implement `resolveFork()`.

**Fix** — implement `resolveFork(canonicalBlocks)` on the target. It must remove rows above the fork
point and return the cursor to resume from.

### E1002 · Fork with no canonical blocks

A fork was detected but no canonical blocks were supplied to resolve it — an internal invariant
violation.

**Fix** — none; please [report it as a bug](https://github.com/subsquid-labs/pipes-sdk/issues).

### E1003 · resolveFork() returned no cursor

The target's `resolveFork()` returned nothing instead of a cursor.

**Fix** — return the cursor to resume from after rolling back.

### E1004 · Portal contract violation

The portal delivered a `canonicalBlocks` set whose highest block is below the target's persisted
cursor. Rows above it would survive the fork rollback and corrupt the new chain, so the pipe refuses
to proceed. Any target that tracks a cursor can raise this.

**Fix** — none in user code; please
[report it as a bug](https://github.com/subsquid-labs/pipes-sdk/issues) against the portal contract.

---

## ClickHouse target

### E2001 · Invalid `maxRows`

The `maxRows` batching option is not a positive number.

**Fix** — set `maxRows` to a value greater than 0 (or omit it for the default).

### E2002 · Unparseable table name

A table identifier could not be parsed as `table` or `database.table`.

**Fix** — pass `table` or `database.table`; quote identifiers that themselves contain dots.

### E2003 · Cannot roll back a Distributed table

Rollback targeted a `Distributed` table. Multi-shard rollback is not supported.

**Fix** — point the rollback at the underlying local table instead.

### E2004 · Rollback engine collapses on the wrong column

The table's collapsing engine collapses on a column other than `sign`. Rollback inserts cancel rows
with `sign = -1`, so the collapse column must be named `sign`.

**Fix** — rename the collapse column to `sign`.

### E2005 · Rollback table has no `sign` column

The table has no `sign` column, so cancel-row rollback cannot work.

**Fix** — add a `sign` column and use a `CollapsingMergeTree`-family engine for tables you roll back.

### E2006 · Invalid rollback index column

The column passed to `ensureRollbackIndex` is not a plain identifier.

**Fix** — pass a plain identifier (letters, digits, underscores; no spaces or expressions).

---

## Postgres (Drizzle) target

### E2101 · Drizzle client missing

The `db` passed to `drizzleTarget` has no underlying client (`$client`).

**Fix** — pass a Drizzle instance created with a real driver, e.g. `drizzle(pool)`.

### E2102 · Invalid retention

`unfinalizedBlocksRetention` is not a positive number.

**Fix** — set it to a value greater than 0.

### E2103 · Advisory lock not acquired

Another process is holding the PostgreSQL advisory lock for this state id.

**Fix** — ensure only one process writes to a given pipe `id` at a time.

### E2104 · Untracked table

A write targeted a table that isn't registered for rollback tracking.

**Fix** — include the table in the `tables` array passed to `drizzleTarget`.

### E2105 · Missing primary key

A snapshot trigger cannot be built for a tracked table without primary key columns.

**Fix** — declare a primary key on the tracked table.

### E2106 · Circular foreign keys

The tracked tables' foreign keys form a cycle, so no safe delete order can be determined.

**Fix** — break the foreign-key cycle among the tracked tables.

---

## BigQuery target

### E2201 · Cannot determine GCP project id

`bigqueryTarget` could not resolve a project id at construction.

**Fix** — pass `projectId` explicitly, or construct `new BigQuery({ projectId })` so
`client.bigquery.projectId` is set.

### E2202 · Partition column missing from schema

A tracked table's declared `schema` omits its block-number / partition column.

**Fix** — add the column to `tables[].schema` as `INT64 NOT NULL`. The target forces that type and
mode, but the column itself must be declared.

### E2203 · Partition column has the wrong type

The partition column is not `INT64`. `FLOAT64`/`NUMERIC` lose precision above 2^53 (Solana slot
numbers exceed this) and non-integer types break `RANGE_BUCKET` pruning, so reorg-cleanup `BETWEEN`
predicates become inexact.

**Fix** — type the partition column as `INT64`.

### E2204 · Partition column is nullable

The partition column is `NULLABLE`. Under SQL three-valued logic, rows with a `NULL` block number
never match the fork `DELETE` predicate and would linger forever.

**Fix** — make the column `REQUIRED` (`NOT NULL`).

### E2205 · Table is not range-partitioned

An existing live table is not range-partitioned on the declared column. A reorg `DELETE` without
partition pruning scans the whole table — unaffordable at scale.

**Fix** — recreate the table with `RANGE_BUCKET` partitioning on the column (the error prints
suggested DDL).

### E2206 · Unsupported field shape for auto-create

Auto-creation cannot emit DDL for `REPEATED` (array) or `RECORD`/`STRUCT` fields.

**Fix** — pre-create the table manually with the proper `ARRAY<...>` / `STRUCT<...>` column and
re-run; the target validates it without recreating.

### E2207 · Declared column missing from live table

A column declared in the schema does not exist in the live table.

**Fix** — add the column to the table, or drop it from the declared schema.

### E2208 · Column type or mode mismatch

A declared column's type or mode (`NULLABLE`/`REQUIRED`/`REPEATED`) differs from the live table.

**Fix** — align the declared schema with the live table, or migrate the table to match.

### E2209 · Write to an unregistered table

Data was written to a table that isn't listed in `tables[]`, so its rows can't be cleaned up on a
reorg.

**Fix** — add the table to `bigqueryTarget({ tables: [...] })`.

### E2210 · Internal schema-map mismatch

Internal invariant violation (schema map and allowlist disagree).

**Fix** — none; please [report it as a bug](https://github.com/subsquid-labs/pipes-sdk/issues).

### E2211 · Corrupt in-flight sync row

A sync row left in `IN_FLIGHT` state is missing its `range_low`/`range_high` bounds, so recovery
can't proceed.

**Fix** — manual intervention: inspect the sync table row for this pipe `id` and repair or clear the
in-flight state.

### E2212 · Orphaned tracked data

The sync table has no row for this pipe `id`, but tracked tables still hold data from a prior run.
Restarting from the initial cursor would re-process every block and duplicate every row, so the
target refuses to start.

**Fix** — if you deliberately reset the sync table, also `TRUNCATE`/drop the tracked tables it names.
If you're upgrading from a pre-`id`-keyed cursor, keep the old cursor by pinning
`settings: { state: { id: 'stream' } }` — see the
[migration guide](https://github.com/subsquid-labs/pipes-sdk/blob/main/packages/subsquid-pipes/MIGRATION.md#10-target-cursors-are-now-keyed-by-the-pipe-id).

### E2213 · BigQuery rejected rows in AppendRows

`AppendRows` returned per-row errors (proto-schema mismatch, `NOT NULL` violation, value out of
range). The affected rows are **not** written.

**Fix** — compare the live table schema against the descriptor the writer uses and fix the offending
column or values.

---

## Parquet target

### E2301 · No tables declared

`parquetTarget` was given an empty `tables` list — nothing to write.

**Fix** — declare at least one table in `parquetTarget({ tables: [...] })`.

### E2302 · Duplicate table name

Two declared tables share a name.

**Fix** — make each table name unique.

### E2303 · Empty schema

A table declared no columns.

**Fix** — declare at least one column.

### E2304 · Block-number column missing

A table's schema omits the block-number column.

**Fix** — add it as an integer column (`INT64`), or set `blockNumberColumn` to the column that
carries the block number.

### E2305 · Block-number column has the wrong type

The block-number column is not an integer type.

**Fix** — declare it `INT64` (or `INT32`).

### E2306 · Unsupported compression codec

A column declared a compression codec the target doesn't support.

**Fix** — use one of the supported codecs (the message lists them).

### E2307 · Unsupported column type

A column declared a type the target doesn't support.

**Fix** — use a supported leaf type, or `LIST` / `STRUCT` (the message lists the supported set).

### E2308 · Write to an unregistered table

Data was written to a table that isn't declared in `tables[]`.

**Fix** — add the table to `parquetTarget({ tables: [...] })`.

### E2309 · File collision

`publish()` would overwrite an existing Parquet file for a block range — a sign of overlapping
segments or a dirty output directory.

**Fix** — write to a clean output directory and don't point two writers at the same one.

### E2310 · Corrupt state file

The persisted state file exists but could not be parsed.

**Fix** — inspect or remove the state file to recover.

### E2311 · Block-number column is optional

The block-number column is declared `optional`, but finalization, file-range naming, and crash
recovery all key off it — a null coerces to an immutable block-0 row.

**Fix** — declare the block-number column required (remove `optional`).

### E2312 · Invalid block-number value

A row's block-number column held a missing or non-finite value.

**Fix** — ensure every row carries a finite integer block number.

### E2313 · Row value does not match column type

A dev-mode value check failed: a required value was null, a `STRUCT` column got a non-object, a
`LIST` column got a non-array, or a leaf value didn't match its declared type.

**Fix** — correct the row so it matches the declared schema.

### E2314 · Crash recovery could not delete an over-cursor file

After a crash, a Parquet file whose blocks exceed the committed cursor could not be deleted; leaving
it would duplicate data on resume.

**Fix** — clear the filesystem error (permissions, locks) and remove the file so recovery can finish.

### E2315 · Invalid nested schema

A nested column declaration is malformed — an empty `STRUCT`, a `LIST` without `element`, a
non-object column declaration, or nesting too deep (possibly cyclic).

**Fix** — a `STRUCT` needs at least one field and a `LIST` needs an `element`; correct the
declaration.
