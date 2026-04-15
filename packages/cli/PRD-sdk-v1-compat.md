## Problem Statement

The Pipes CLI (`pipes init`) generates indexer projects that use the **pre-1.0 Pipes SDK API**. The SDK has shipped breaking changes (`.pipeComposite()` removed, `outputs` option required, mandatory pipe `id` for cursor persistence, data shape changes, import renames). Projects scaffolded by the CLI today produce code that will not compile against Pipes SDK 1.0.

Secondary issues:
- The SVM `token-balances` template uses removed APIs (`createTransformer`, `PortalStreamData`, `SolanaQueryBuilder`, `data.blocks`) and is currently disabled.
- The generated README contains a metrics example that references the old `.pipe({...})` source-level pattern.
- All existing test snapshots validate the old generated code and will fail once the templates change.

## Solution

Update every code-generation path in the CLI so that scaffolded projects use the Pipes SDK 1.0 API:

1. Replace `.pipeComposite({...}).pipeTo(sink)` with `outputs: {...}` inside the source constructor, followed by `.pipeTo(sink)`.
2. Generate a random, stable `id` on every portal source that calls `.pipeTo()`.
3. Rewrite the `token-balances` SVM template to use the current SDK surface and re-enable it.
4. Fix the README metrics example to use `outputs` instead of source-level `.pipe()`.
5. Update all test snapshots to match the new generated output.

## User Stories

1. As a developer running `pipes init`, I want the generated project to compile and run against Pipes SDK 1.0, so that I don't have to manually migrate the scaffolded code.
2. As a developer running `pipes init` with multiple EVM templates, I want the generated `index.ts` to pass decoders via `outputs: { decoder1, decoder2 }` on `evmPortalSource`, so that it follows the current SDK API.
3. As a developer running `pipes init` with a single EVM template, I want the generated `index.ts` to pass the decoder via `outputs: decoder` on `evmPortalSource`, so that single-decoder projects also use the current API.
4. As a developer running `pipes init` with SVM templates, I want the generated `index.ts` to pass decoders via `outputs` on `solanaPortalSource`, so that Solana indexers also follow the current SDK API.
5. As a developer, I want a unique `id` automatically generated on the portal source in my scaffolded project, so that cursor persistence works correctly without me having to invent one.
6. As a developer choosing the SVM `token-balances` template, I want the generated code to use the current SDK transformer API (no `createTransformer`, no `data.blocks`), so that it compiles and runs.
7. As a developer reading the generated README, I want the metrics example to show the current `outputs`-based API, so that I don't copy-paste outdated code.
8. As a CLI maintainer, I want all test snapshots to reflect the new generated code, so that CI stays green after the migration.
9. As a developer, I want the generated `id` to be short and random (not derived from my project name), so that multiple projects can coexist without cursor collisions.
10. As a developer using the custom EVM template with multiple contracts grouped into decoders, I want each decoder group passed correctly inside `outputs`, so that composite decoding still works.
11. As a developer using the Uniswap V3 template, I want the factory-based decoder passed via `outputs`, so that advanced templates also follow the current API.
12. As a developer using the ClickHouse sink, I want the `onData` callback to reference `data.<decoderId>` correctly when decoders are inside `outputs`, so that sink writes are not broken.
13. As a developer using the PostgreSQL sink, I want the Drizzle `onData` callback to reference `data.<decoderId>` correctly when decoders are inside `outputs`, so that sink writes are not broken.

## Implementation Decisions

### Module: EVM Transformer Builder

The Mustache template in the EVM transformer builder currently renders:

```
evmPortalSource({ portal: '...' })
  .pipeComposite({ decoder1, decoder2 })
  .pipeTo(sink)
```

Change to:

```
evmPortalSource({
  id: '<random-id>',
  portal: '...',
  outputs: {
    decoder1,
    decoder2,
  },
}).pipeTo(sink)
```

The template must handle both single-decoder and multi-decoder cases. When a single template yields one decoder ID, it should render `outputs: { decoderId }` (still an object — the sink `onData` callback always accesses `data.<name>`). When multiple template IDs exist (from multi-decoder custom templates), all are listed inside `outputs`.

### Module: SVM Transformer Builder

Same structural change as EVM: replace `.pipeComposite({...}).pipeTo(sink)` with `outputs: {...}` inside `solanaPortalSource`. Remove the commented-out `.pipe()` usage hint in the template since it references the old API.

### Module: Random ID Generator

Introduce a small utility that generates a short random string (e.g., 8-character hex or nanoid-style) at template rendering time. This ID is injected into the Mustache template as the `id` field on the portal source. No new dependencies — use `crypto.randomBytes` or equivalent.

### Module: Token Balances Template (SVM)

Rewrite the transformer to drop:
- `createTransformer` import
- `PortalStreamData` / `SolanaBlock` / `SolanaFieldSelection` types
- `SolanaQueryBuilder` generic parameter
- `data.blocks` accessor (use `data` directly)

Replace with a `solanaInstructionDecoder`-style or direct query-based approach consistent with the SDK 1.0 surface. Re-enable the template in the SVM template registry (`svm/index.ts`).

### Module: README Template

Update the metrics example in the generated README. The current example shows:

```ts
evmPortalSource({ portal: '...' })
  .pipe({ profiler: { id: '...' }, transform: ... })
```

Change to:

```ts
evmPortalSource({
  id: '<pipe-id>',
  portal: '...',
  metrics: metricsServer(),
  outputs: evmDecoder({ ... }),
}).pipeTo(...)
```

### Module: Base Transformer Builder Types

The `TemplateValues` interface and `TransformerTemplateBuilder` interface may need a new field for the generated `id`. Evaluate whether the ID is best injected at the `TransformerBuilder.render()` level (where all template values are assembled) or inside the Mustache template itself.

### Data flow is unchanged

The sink builders (PostgreSQL, ClickHouse) reference `data.<templateId>` and `data.<decoderId>.<event>` in their `onData` callbacks. Since moving decoders into `outputs` does not change the data shape (confirmed in SDK release notes: "The `data` shape is unchanged"), the sink templates should not need changes beyond verifying they still work.

## Testing Decisions

### What makes a good test

Tests should verify the **external output** of the code generators — the rendered string that becomes `src/index.ts`, `schemas.ts`, etc. They should not test internal helper calls or Mustache rendering mechanics. A test passes when the generated code string matches the expected snapshot.

### Modules to test

1. **EVM Transformer Builder** — existing test file (`evm-tansformer-builder.test.ts`). Update all inline snapshots to reflect `outputs` syntax, `id` field, and removal of `.pipeComposite()`. The random ID should be seeded or mocked in tests for deterministic snapshots.
2. **SVM Transformer Builder** — existing test file (`svm-transformer-builder.test.ts`). Same snapshot updates. Re-enable or add test for token-balances template if it was previously skipped.
3. **Sink Builder** — existing test file (`sink-builder.test.ts`). Verify snapshots still pass (data shape unchanged). Update if the sink template references changed.
4. **Schema Builder** — existing test file (`schema-builder.test.ts`). Likely no changes needed, but verify.
5. **Init Handler** — existing test file (`init.handler.test.ts`). End-to-end scaffolding test. Update snapshots if the generated project structure changed.
6. **Random ID utility** — add a unit test confirming it produces a string of expected length and format, and that two calls produce different values.

### Prior art

All existing tests use Vitest with inline snapshots (`toMatchInlineSnapshot`). Tests for builders instantiate template config objects with hardcoded params and call `.render()`, then assert on the output string. Follow this same pattern.

## Out of Scope

- **Time-based ranges**: The CLI will continue to prompt for block numbers only. ISO date support in ranges is not part of this work.
- **Runner API (`createDevRunner`)**: Generated projects will keep the single `main()` function pattern. Multi-pipe runner adoption is deferred.
- **OpenTelemetry integration**: No OTEL setup will be added to generated projects.
- **New templates**: No new EVM or SVM templates will be created. Only existing templates are updated.
- **CLI command changes**: No new commands, flags, or prompt flows are added. The `pipes init` UX remains the same.
- **Pipes SDK source code changes**: This PRD only covers the CLI package. The SDK itself is already at 1.0.

## Further Notes

- The random `id` generation must happen at render time (when Mustache processes the template), not at project runtime. The ID is baked into the generated source code.
- The SVM `token-balances` template may require verifying which SDK exports are available for token balance queries in 1.0, since the old `SolanaQueryBuilder.addTokenBalance()` and `createTransformer` APIs are removed. If the SDK 1.0 provides no direct replacement, the template should be adapted to use `solanaQuery()` with the new builder pattern.
- All snapshot updates should be done by running the tests and updating inline snapshots, not by hand-editing expected strings.
