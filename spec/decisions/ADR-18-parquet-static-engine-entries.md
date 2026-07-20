# ADR-18 — Parquet engine libraries are static imports behind subpath entries

Status: Accepted

## Context

Both built-in engines loaded their libraries through dynamic `import()` so the
libraries could stay optional peers of one entry point. That bought optionality with
async plumbing (module-level promise caches, per-table schema thunks), late failures
(a missing library surfaced at the first row append, potentially minutes into a run,
rather than at construction), and an opaque loading mechanism. Engine-name string
sugar (`engine: 'duckdb'`) also forced the core entry to reference the duckdb
factory, coupling the core to the optional engine.

## Decision

The module graph, not runtime loaders, enforces the optional peers. The core
`targets/parquet` entry statically imports `@dsnp/parquetjs` — the wired-in
zero-config default (the drizzle/knex pick-your-client pattern). Everything duckdb
lives behind a separate `targets/parquet/duckdb` subpath entry that statically
imports `@duckdb/node-api`. Both libraries remain optional peer dependencies;
importing an entry without its library installed fails at import time with the
runtime's own module-not-found error naming the missing package. Engine-name strings
are deleted: `settings.engine` accepts only engine instances. The dependency
direction is strictly one-way — `duckdb/` imports core; core never references duckdb,
even type-only — pinned by a guard test that scans core sources for any duckdb
reference. The retired dynamic-load error codes keep their numbers unassigned rather
than being reused (ADR-4's stable-code discipline).

## Consequences

Misconfiguration surfaces at import time instead of mid-run, and the loading
mechanism is plain imports a reader can trace. Non-parquet consumers install neither
library and see no warnings. Passing the old `'duckdb'` string fails construction
with the coded invalid-engine error — the migration signal. The subpath split is kept
honest by the guard test plus a built-output check that the distributed core entry
contains no duckdb reference.
