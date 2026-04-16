# Plan: Fix Finalization Regression (v2 — addresses review blockers)

## Summary

Add a finalized-head high-water mark inside `createPortalStream()` that clamps any regressed `finalized` value to the highest previously seen value within the stream's lifetime. Write targeted tests exercising the regression scenario via the existing `createMockPortal` infrastructure.

---

## Steps

### Step 1: Add high-water mark guard in `createPortalStream()`

**Action:** In `portal-client/client.ts`, inside `createPortalStream()`, declare `let finalizedHighWaterMark: BlockRef | undefined` before the `while` loop. After `const res = await requestStream(...)`, introduce a `let head = res.head` that applies the guard. Use `head` instead of `res.head` for all downstream operations (block splitting, buffer.put calls).

**Files touched:**
- `packages/subsquid-pipes/src/portal-client/client.ts`

**Exact change location:** Inside `createPortalStream()` — the `ingest` async function. After the `requestStream()` call, before the `res.status` check.

**Implementation:**
```typescript
// Before the while loop, alongside existing `fromBlock` and `parentBlockHash`:
let finalizedHighWaterMark: BlockRef | undefined

// After `const res = await requestStream(...)`:
let head = res.head
if (head.finalized) {
  if (finalizedHighWaterMark && head.finalized.number < finalizedHighWaterMark.number) {
    head = { ...head, finalized: finalizedHighWaterMark }
  } else {
    finalizedHighWaterMark = head.finalized
  }
}

// Then replace all `res.head` usages with `head`:
// - 204 path: buffer.put({ blocks: [], head, ... })
// - 200 path: const finalizedHead = head.finalized?.number
// - 200 path: buffer.put({ blocks: ..., head, ... }) (both finalized and unfinalized puts)
```

Key decisions:
- We use a separate `let head` variable — `res` stays `const`, no mutation of the original response object (fixes reviewer blocker #1).
- We replace the entire `BlockRef` when clamping (preserves hash invariant from brainstorm).
- We do NOT add logging (no logger available in this scope).
- The guard handles `finalized: undefined` — if undefined, the `if (head.finalized)` check skips the guard.

**Done-signal:** TypeScript compiles (`pnpm turbo build`). Existing tests pass. Full verification in Step 2.

**Dependencies:** None.

---

### Step 2: Add test — finalized head regression is clamped (with hash verification)

**Action:** Create `portal-client/client.test.ts` (new file, collocated with `client.ts`). Test that when the Portal returns a regressed finalized number, the consumer sees the high-water mark's BlockRef (both number AND hash).

**Files touched:**
- `packages/subsquid-pipes/src/portal-client/client.test.ts` (new file)

**Implementation approach:**
- Use `createMockPortal` with 3 `200` responses:
  - Response 1: block 1, finalized={number: 10, hash: '0xA'}
  - Response 2: block 2, finalized={number: 7, hash: '0xB'} (regression)
  - Response 3: block 3, finalized={number: 12, hash: '0xC'}
- Create `PortalClient` pointed at mock, call `getStream()` with a simple query, collect batches.
- Assert for each batch:
  - Batch 1: `head.finalized = {number: 10, hash: '0xA'}`
  - Batch 2: `head.finalized = {number: 10, hash: '0xA'}` (clamped — same hash!)
  - Batch 3: `head.finalized = {number: 12, hash: '0xC'}` (advances past HWM)
- Stream terminates naturally when mock runs out of responses (mock returns 500 on unexpected requests, which causes the stream to error/end).

**Done-signal:** `pnpm vitest run src/portal-client/client.test.ts` passes. Both `.number` and `.hash` assertions pass.

**Dependencies:** Step 1.

---

### Step 3: Add test — monotonic increase (happy path)

**Action:** In the same test file, verify that when finalized numbers only increase, all values pass through unchanged.

**Files touched:**
- `packages/subsquid-pipes/src/portal-client/client.test.ts`

**Implementation:**
- Mock: finalized=5, finalized=10, finalized=15 across 3 responses.
- Assert consumer sees `[{number:5,...}, {number:10,...}, {number:15,...}]` — all original hashes preserved.

**Done-signal:** Test passes.

**Dependencies:** Step 1, Step 2 (file exists).

---

### Step 4: Add test — finalized undefined then defined

**Action:** Test that when `finalized` starts as `undefined`, then becomes defined, the guard correctly initializes the high-water mark on the first defined value.

**Files touched:**
- `packages/subsquid-pipes/src/portal-client/client.test.ts`

**Implementation:**
- Mock: response 1 has no finalized headers + blocks, response 2 has finalized=10 + blocks.
- Assert: batch 1 has `finalized: undefined`, batch 2 has `finalized: {number: 10, ...}`.

**Done-signal:** Test passes.

**Dependencies:** Step 1, Step 2 (file exists).

---

### Step 5: Extend mock portal to support 204 with finalized headers, then add test

**Action:** This is two sub-steps:

**Step 5a:** Extend `MockResponse` type in `testing/test-portal.ts` to allow `head` on `204` responses. Update the mock server's `default` case (or add a `case 204`) to emit finalized headers when present.

**Files touched:**
- `packages/subsquid-pipes/src/testing/test-portal.ts`

**Change:**
```typescript
// Update the 204 type to include optional head:
| {
    statusCode: 204
    head?: {
      finalized?: { number: number; hash: string }
      latest?: { number: number }
    }
    validateRequest?: ValidateRequest
  }

// Add case 204 in the switch:
case 204: {
  const headers204: Record<string, string | number> = {}
  if (mockResp.head?.finalized?.number) {
    headers204['X-Sqd-Finalized-Head-Number'] = mockResp.head.finalized.number
  }
  if (mockResp.head?.finalized?.hash) {
    headers204['X-Sqd-Finalized-Head-Hash'] = mockResp.head.finalized.hash
  }
  if (mockResp.head?.latest?.number) {
    headers204['X-Sqd-Head-Number'] = mockResp.head.latest.number
  }
  res.writeHead(204, headers204)
  break
}
```

**Step 5b:** Add a test in `client.test.ts` for 204 responses with regressed finalized.
- Mock: response 1 (200) finalized=10 + blocks, response 2 (204) finalized=7, response 3 (200) finalized=12 + blocks.
- Assert: batch heads show finalized=[10, 10, 12] — the 204's regressed value is clamped.

Note: The 204 path in `createPortalStream` calls `buffer.put` with empty blocks and then continues polling. The mock must return the 200 after the 204 for the stream to produce more data.

**Done-signal:** Both the mock extension and the test compile and pass.

**Dependencies:** Step 1, Step 2 (file exists).

---

### Step 6: Run full test suite and lint

**Action:** Run all tests (excluding external-service-dependent ones) and linter/type checker.

**Commands:**
```bash
cd packages/subsquid-pipes
pnpm vitest run --exclude '**/clickhouse*' --exclude '**/postgres*'
pnpm turbo build
```

**Files touched:** None (fix any issues that arise).

**Done-signal:** All tests pass. Build succeeds with zero errors.

**Dependencies:** Steps 1-5.

---

## Test strategy

| Scenario | Type | Step | Asserts |
|----------|------|------|---------|
| Finalized regression → clamped (number + hash) | Unit | 2 | `.number` AND `.hash` match HWM |
| Monotonic increase → transparent | Unit | 3 | All original values pass through |
| Undefined → defined transition | Unit | 4 | HWM initializes on first defined |
| 204 response with regression → clamped | Unit | 5b | 204 head also gets guard |
| Existing tests (stream-buffer, fork, portal-source) | Regression | 6 | No failures |

## Rollback plan

Two files changed (`client.ts` edit + `test-portal.ts` mock extension), one file created (`client.test.ts`). Revert the commit. No migrations, no config changes, no public API changes.

## Risks carried forward

1. **Restart/bootstrap window:** Accepted — persisted per-record finalized values are correct.
2. **Deep reorg masking:** Accepted — stream restart resets HWM.
3. **No observability:** Accepted — can be added later with metrics.
