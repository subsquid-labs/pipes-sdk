# ADR-18 — Parquet engine libraries are static imports; one built-in engine

Status: Accepted

## Context

The built-in engine loaded `@dsnp/parquetjs` through dynamic `import()` so the
library could stay an optional peer of one entry point. That bought optionality with
async plumbing (module-level promise caches, per-table schema thunks), late failures
(a missing library surfaced at the first row append, potentially minutes into a run,
rather than at construction), and an opaque loading mechanism. Engine-name string
sugar (`engine: 'duckdb'`) also forced the core entry to reference engine factories
it should not know about.

## Decision

The module graph, not runtime loaders, enforces the optional peer. The core
`targets/parquet` entry statically imports `@dsnp/parquetjs` — the wired-in
zero-config default (the drizzle/knex pick-your-client pattern) and the SDK's only
built-in engine. The library remains an optional peer dependency; importing the
entry without it installed fails at import time with the runtime's own
module-not-found error naming the missing package. Engine-name strings are deleted:
`settings.engine` accepts only `ParquetEngine` instances. Alternative engines live
in their own packages, statically import their own libraries, and plug in through
the public seam (ADR-17) — the SDK never references them. The retired dynamic-load
error codes keep their numbers unassigned rather than being reused (ADR-4's
stable-code discipline).

## Consequences

Misconfiguration surfaces at import time instead of mid-run, and the loading
mechanism is plain imports a reader can trace. Non-parquet consumers install nothing
extra and see no warnings. External engines carry their own dependency story; the
SDK declares no engine library beyond parquetjs.
