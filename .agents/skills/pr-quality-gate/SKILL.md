---
name: pr-quality-gate
description: Runs automatically before creating a PR. Validates test coverage for new code, generates a coverage diff against the base branch, and ensures the internal testing framework is used.
---

# PR Quality Gate

This skill enforces quality standards before a PR is created. It MUST be applied automatically whenever the agent is about to create a pull request (e.g. via `gh pr create` or the `/commit` + PR flow).

## When to activate

Run this checklist **before** calling `gh pr create`. Do NOT skip any steps.

## Step 1: Verify new code has tests

1. Run `git diff <base-branch>...HEAD --name-only` to list all changed files.
2. For each new or modified `.ts` source file in `packages/subsquid-pipes/src/` (excluding `*.test.ts`, `index.ts`, and `types.ts`):
   - Check if a corresponding `.test.ts` file exists next to it.
   - If the file contains new exported functions, classes, or significant logic changes — there MUST be tests covering them.
3. If tests are missing, **write them** before proceeding or flag it explicitly in the PR description under a `## Missing tests` section.

## Step 2: Use the internal testing framework

When writing tests for this project, always prefer the built-in test utilities over creating ad-hoc mocks:

### EVM tests

```ts
import { encodeEvent, evmPortalMockStream, mockBlock, resetMockBlockCounter } from '~/testing/evm/index.js'
import { createMockPortal, readAll } from '~/testing/index.js'
```

- `mockBlock()` — creates a block with auto-generated metadata (number, hash, parentHash, timestamp)
- `encodeEvent()` — encodes event args into portal log format using a viem ABI
- `evmPortalMockStream()` — wraps blocks into a mock HTTP portal server
- `createMockPortal()` — lower-level mock portal for custom response sequences (204, 409, 503, etc.)
- `readAll()` — consumes a portal stream into an array
- `resetMockBlockCounter()` — call in `beforeEach` for deterministic block numbers

### General tests

```ts
import { createTestLogger } from '~/testing/index.js'
import { MockPortal, createMockPortal, MockResponse } from '~/testing/index.js'
```

### Test conventions

- Tests live next to source: `feature.ts` → `feature.test.ts`
- Use `describe` / `it` / `beforeEach` / `afterEach` from vitest
- Clean up resources (mock portals, connections) in `afterEach`, not `try/finally`
- Use `toEqual` for deep comparison, `toMatchInlineSnapshot` for complex output
- Run tests from the package directory: `pnpm vitest run src/path/to/file.test.ts`

## Step 3: Start test infrastructure via Docker Compose

Integration tests require ClickHouse and PostgreSQL. Start them using the project's `docker-compose.yml`:

```bash
cd packages/subsquid-pipes
docker compose up -d
```

This starts:
- **ClickHouse** on port `10123` (image: `clickhouse/clickhouse-server:25.10`)
- **PostgreSQL** on port `5432` (image: `postgres:18`, user: `postgres`, password: `postgres`)

Environment variables (defaults already match the compose config):
- `TEST_CLICKHOUSE_URL=http://localhost:10123`
- `TEST_POSTGRES_DSN=postgresql://postgres:postgres@localhost:5432/postgres`

Wait for services to be healthy before running tests. Do NOT tear down containers after — leave them running for subsequent test runs.

## Step 4: Generate coverage diff

Run coverage on **both** the base branch and the current branch, then include the diff in the PR body.

### Procedure

```bash
# 1. Record current branch
CURRENT_BRANCH=$(git branch --show-current)
BASE_BRANCH="design/sdk1"  # or the PR target branch

# 2. Run coverage on current branch (JSON summary)
cd packages/subsquid-pipes
pnpm vitest run --coverage --coverage.reporter=json-summary --bail=0 2>/dev/null
cp coverage/coverage-summary.json /tmp/coverage-head.json

# 3. Stash changes, switch to base, run coverage
cd ../..
git stash
git checkout $BASE_BRANCH
cd packages/subsquid-pipes
pnpm vitest run --coverage --coverage.reporter=json-summary --bail=0 2>/dev/null
cp coverage/coverage-summary.json /tmp/coverage-base.json

# 4. Return to working branch
cd ../..
git checkout $CURRENT_BRANCH
git stash pop 2>/dev/null
```

### Parse and format the diff

Read both JSON files. Group individual file entries by their parent directory (e.g. `src/core/query-builder.ts` → `src/core`). For each directory, sum `covered` and `total` across all files to compute the directory-level percentage. Format as a markdown table showing only the `total` row and directories where coverage changed (|Δ| >= 0.1):

```markdown
## Coverage

| Module | Stmts | Δ | Branch | Δ |
|--------|-------|---|--------|---|
| **All files** | 75.1% | +0.3 | 80.6% | +1.0 |
| src/core | 73.2% | +1.1 | 85.8% | +2.4 |
| src/internal | 92.9% | +1.8 | 85.5% | +7.4 |
```

Rules:
- Group by directory, NOT individual files
- Show Δ with `+` / `-` prefix
- Bold any module where statements dropped by more than 1%
- Only show directories with changes (|Δ| >= 0.1) — skip unchanged modules
- If overall coverage decreased, add a warning: `⚠️ Overall coverage decreased`

### Include in PR body

Append the coverage table to the PR description body before calling `gh pr create`.

## Step 5: PR description format

Every PR created by the agent must follow this template:

```markdown
## Summary
<1-3 bullet points describing what changed>

## Coverage

<coverage diff table from Step 4>

## Test plan
<bulleted checklist of what is tested>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```
