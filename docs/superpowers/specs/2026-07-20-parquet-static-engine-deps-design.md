# Static engine dependencies for the Parquet target — design

**Date:** 2026-07-20
**Status:** Approved by Ian (this document records the approved design; see Decision history)
**Baseline:** branch `worktree-parquet-duckdb-engine` at `1136c8f` (pluggable `ParquetEngine` interface merged into PR #124)

## Problem

Both built-in Parquet engines load their libraries through dynamic `import()` so that
`@dsnp/parquetjs` and `@duckdb/node-api` can be optional peers of a single
`@subsquid/pipes/targets/parquet` entry. That mechanism drags in real complexity:

- **Async plumbing**: module-level promise caches (`apiPromise ??= import(...)`), per-table
  `schema: () => Promise<ParquetSchema>` thunks, a `Promise.all` load dance on the first
  `appendRow`, sticky-rejection subtleties.
- **Late failures**: a missing library surfaces at the first `appendRow` (first segment open),
  potentially minutes into a run, not at `parquetTarget()` construction.
- **Opaque mechanism**: runtime module resolution and hidden module-level state instead of
  plain imports a reader can trace.

## Decision history

- 2026-07-20, Ian: hates the dynamic loading — all four aspects above **including** runtime
  conditional loading as a goal.
- 2026-07-20, Ian: libraries stay **peerDependencies** — the drizzle/knex "pick your client"
  pattern, not regular dependencies.
- 2026-07-20, Ian: **parquetjs stays the wired-in zero-config default** in the core entry;
  only duckdb moves behind its own pick-a-client entry point.
- 2026-07-20, Ian: approved the design below.

## Design

### 1. Dependency declarations — unchanged

`@dsnp/parquetjs` and `@duckdb/node-api` (pinned `1.5.4-r.1`) keep their current
declarations: `peerDependencies` + `peerDependenciesMeta.optional: true`, plus
`devDependencies` so the test suite runs. What changes is the **enforcement mechanism**:
the module graph replaces runtime loaders.

- Importing `@subsquid/pipes/targets/parquet` without `@dsnp/parquetjs` installed fails at
  import time with Node's own `ERR_MODULE_NOT_FOUND` naming the missing package.
- Importing `@subsquid/pipes/targets/parquet/duckdb` without `@duckdb/node-api` fails the
  same way.
- Non-parquet SDK consumers install nothing and see no warnings (both peers stay
  optional-flagged).

### 2. Entry-point layout

```
@subsquid/pipes/targets/parquet          # core: target, store, contract, toolkit, parquetjs engine
@subsquid/pipes/targets/parquet/duckdb   # duckdb engine (new subpath entry)
```

Source layout (files move with `git mv` to preserve history):

```
src/targets/parquet/
  engine.ts  errors.ts  fs-durable.ts  index.ts  parquet-state.ts  parquet-store.ts
  parquet-target.ts  parquetjs-schema.ts  parquetjs-writer.ts  schema.ts  segment.ts
  (+ their tests, custom-engine.test.ts, optional-deps.test.ts)
  duckdb/
    index.ts            # new: the subpath's public surface
    duckdb-engine.ts  duckdb-schema.ts  duckdb-writer.ts
    duckdb-engine.test.ts  duckdb-schema.test.ts  duckdb-writer.test.ts
    parquet-target-duckdb.test.ts   # target+duckdb integration test lives with the engine
```

Deleted outright: `parquetjs-engine.ts`, `parquetjs-engine.test.ts`.

Dependency direction is strictly one-way: `duckdb/` imports core (`../schema.js`,
`../segment.js`, `../errors.js`, type-only `../engine.js`); core never references `duckdb/`.

`package.json` gains a `./targets/parquet/duckdb` export entry mirroring the existing
`./targets/parquet` entry shape exactly (import/require/types per build format); tsup gains
the matching entry. `duckdb/index.ts` exports: `duckdbEngine`, `type DuckdbEngine`,
`type ParquetDuckdbSettings`. These three are **removed from the core `index.ts`**, as is
`type ParquetEngineName` (deleted per §5); the rest of the core surface is unchanged.

### 3. Core entry: parquetjs becomes a plain static dependency

- `parquetjs-writer.ts` imports `ParquetSchema` and `ParquetWriter` as **values**.
- `parquetjsEngine().table()` compiles `new ParquetSchema(toParquetSchemaShape(...))`
  **synchronously**; the per-table memoized promise and `getSchema` thunk are deleted.
- `ParquetjsSegmentWriterOptions.schema` reverts to `schema: ParquetSchema`.
- `appendRow`'s first-open drops the `Promise.all([loadParquetjs(), getSchema()])` dance:
  open the stream, `ParquetWriter.openStream(schema, stream, ...)`, keeping the existing
  destroy-stream-on-throw error path.
- **Lazy file open per segment stays.** A table receiving no rows still never creates an
  empty `.parquet` file — that behavior was never about dependency loading.

### 4. DuckDB entry

- `duckdb-engine.ts` deletes `loadDuckdbApi` and the `DuckdbApi` (`typeof import(...)`)
  promise machinery; it imports `@duckdb/node-api` statically (values where needed,
  `import type` where a type suffices).
- Shared-instance semantics (`acquireDuckdbInstance`, one process-wide instance per
  `(threads, memoryLimit)`) are untouched.
- `DuckdbSegmentWriter.#open` stays async (DB connect/appender are async APIs) but no longer
  awaits a module load.
- `E2317 DUCKDB_UNAVAILABLE` dies with the loader.

### 5. `settings.engine`: string sugar removed

`'duckdb'` cannot survive (the core cannot import the factory), and a lone `'parquetjs'`
string adds nothing over omitting the field. Therefore:

- `type ParquetEngineName` is **deleted**.
- `ParquetSettings.engine?: ParquetEngine` — omitted → default `parquetjsEngine()`.
- `resolveEngine(engine: ParquetEngine | undefined): ParquetEngine`:
  `undefined` → `parquetjsEngine()`; a structurally valid instance
  (`{ name: string, table: function }`) → itself; anything else →
  `ParquetTargetError(ENGINE_INVALID)` with the message:
  `parquetTarget: settings.engine must be a ParquetEngine implementation ({ name, table() }) or omitted for the default parquetjs engine, got <descriptor>.`
  where `<descriptor>` keeps the current rendering rule: `'<value>'` for strings, `typeof`
  otherwise. (Strings — including `'parquetjs'` and `'duckdb'` — now take this rejection
  path; the `'duckdb'` rejection is the migration signal for anyone still passing the old
  sugar.)
- `E2318 ENGINE_INVALID` stays; its doc comment becomes:
  `` /** `settings.engine` is not a ParquetEngine implementation. */ ``

### 6. Error-code band

`E2317` and `E2319` are deleted **without renumbering**. A band comment records the gap:
`// E2317 and E2319 retired: optional-dependency load errors — engines statically import their libraries.`

### 7. Guard test, repurposed

`optional-deps.test.ts` keeps its self-testing pure-detector pattern but now asserts **core
isolation from duckdb**:

1. No non-test `.ts` file in `src/targets/parquet/` outside `duckdb/` references
   `@duckdb/node-api` in any import/export form — including type-only (the core must not
   know duckdb at all).
2. No non-test core file imports from `./duckdb/`.
3. The detector self-test feeds a synthetic violation so the guard cannot rot into an
   always-pass.

The `@dsnp/parquetjs` half of the old guard is dropped — static core imports of it are now
the design.

### 8. Contract JSDoc

`ParquetEngine`'s "Implementations MUST" list drops the "defer library loading and other
async setup to the first `appendRow`" clause; the bullet becomes "keep `table()` synchronous
and cheap". Engines with their own optional libraries may still defer internally — their
business, not a contract requirement. Factory JSDocs reword "optional peer dependency,
loaded lazily on first segment open" to name the peer and its entry point
(e.g. "Requires the `@duckdb/node-api` peer — install it and import this engine from
`@subsquid/pipes/targets/parquet/duckdb`").

### 9. Ripples (exhaustive)

Tests:
- `engine.test.ts`: string-mapping cases die; add cases pinning that `'parquetjs'` and
  `'duckdb'` strings now throw `ENGINE_INVALID`; instance-passthrough and default cases stay.
- `parquet-target.test.ts`: rejection-message regex updated; the five
  `schema: () => Promise.resolve(schema)` thunk sites revert to `schema`.
- `parquet-target-duckdb.test.ts`: moves into `duckdb/`; every `'duckdb'` string usage
  becomes a `duckdbEngine()` instance; the string-vs-instance parity test is deleted (its
  premise is gone — the sibling differential tests keep covering engine parity).
- `duckdb-engine.test.ts`: the loader load-and-cache test dies; instance-sharing and
  config-application tests stay.
- `custom-engine.test.ts`, `parquet-store.test.ts`: unchanged (already instance-based).

Docs in code:
- `ParquetSettings.engine` JSDoc (parquet-target.ts) rewritten: no string forms; names the
  default, the duckdb entry import, and the unchanged footer-metadata/rotation caveats.

Scripts:
- `scripts/bench-parquet.ts`, `scripts/bench-parquet-deep.ts`: `schema` thunks revert to
  direct `ParquetSchema` values; duckdb import paths follow the `duckdb/` move.
- `scripts/bench-pipeline/run-one.ts`: settings literal becomes
  `engine: options.engine === 'duckdb' ? duckdbEngine({ threads: options.threads }) : parquetjsEngine()`
  with relative imports; `run-one.test.ts` asserts `engine.name` for both branches.

Docs (post-implementation, outside the code change): PR #124 body — Usage section (duckdb
import line), error-code list (E2317/E2319 removal), pluggable-interface section (loading
paragraph), coverage refresh per the repo's PR convention.

## Out of scope

- The `ParquetEngine` contract shape, store/target engine-agnosticism, `SegmentWriter`
  toolkit, rotation/recovery/checkpoint behavior: all untouched.
- The accepted-minors cleanup batch from the interface final review (tracked in PR #124
  follow-ups) stays separate.
- npm README / user-facing docs beyond the PR body.

## Compatibility

The `settings.engine` API is unreleased (this branch); no shims. Breaking deltas vs the
branch head: engine strings rejected, duckdb symbols move to the `/duckdb` entry,
`ParquetEngineName`/`E2317`/`E2319` deleted.

## Verification

- Full suites: `src/targets/parquet/` and `scripts/` under Node 22
  (`mise exec node@22.23.1 -- corepack pnpm vitest run ...`), `pnpm build` (both formats),
  `tsc --noEmit` (pre-existing TS4111 in `bench-parquet-deep.ts` remains the only delta).
- Built-output check: the dist core entry (esm + cjs) contains no reference to
  `@duckdb/node-api`; the dist duckdb entry statically requires/imports it.
- The reshaped guard test is RED-proven during implementation (inject a core reference to
  `@duckdb/node-api`, watch it fail naming file+line, revert).

## Risks

- **CJS named-export interop** for static `@dsnp/parquetjs` imports: this was the
  pre-refactor state of the codebase (known good) — low risk.
- **Deep-import consumers** of moved duckdb files: only the two bench scripts (updated
  here); the guard test plus `tsc` catch stragglers.
- **Dual-format build** of the new entry: mirrors the existing subpath entry; verified by
  the built-output check above.
