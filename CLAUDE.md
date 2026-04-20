# Project: subsquid-pipes SDK

## Key conventions

- Package manager: **pnpm** (v10)
- Test runner: **vitest** (run from `packages/subsquid-pipes/`)
- Linter/formatter: **Biome**
- Build: **tsup** via **turbo**

## Testing

- Tests live next to source files: `feature.ts` → `feature.test.ts`
- Always use the internal testing framework from `~/testing/` — do NOT create ad-hoc HTTP mocks
- EVM test helpers: `mockBlock`, `encodeEvent`, `evmPortalMockStream`, `resetMockBlockCounter` from `~/testing/evm/`
- General helpers: `createMockPortal`, `readAll`, `createTestLogger` from `~/testing/`
- Clean up mock portals in `afterEach`, not `try/finally`
- Run tests: `pnpm vitest run src/path/to/file.test.ts` (from `packages/subsquid-pipes/`)
- Some tests require external services (ClickHouse, PostgreSQL) — exclude with `--exclude` flags when running locally

## PR workflow

Before creating any PR, the agent MUST follow the `pr-quality-gate` skill:
1. Verify new/changed code has test coverage
2. Generate a coverage diff (base vs head) and include it in the PR body
3. Use the internal testing framework for all new tests
