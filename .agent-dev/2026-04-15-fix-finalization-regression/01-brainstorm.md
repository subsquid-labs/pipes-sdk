# Brainstorm: Fix Finalization Regression (v2 — addresses review blockers)

## Problem

**What:** The Portal API can return a `X-Sqd-Finalized-Head-Number` value that is *lower* than the previously observed finalized head. The subsquid-pipes SDK treats finalization as a monotonically increasing value throughout the codebase, so a regression in finalized head number causes incorrect behavior in multiple subsystems.

**For whom:** All subsquid-pipes indexer users — this affects the core data ingestion pipeline, not a niche feature.

**Why now:** This is a live regression. The Portal API's behavior cannot be changed on our side, so the SDK must defend against it.

### Impact areas in the codebase

1. **Block splitting** (`portal-client/client.ts:302-307`) — Incoming blocks are partitioned into finalized/unfinalized based on `res.head.finalized?.number`. If this number drops, blocks that were previously classified as "finalized" could now be classified as "unfinalized" in the next batch, causing duplicate data delivery and inconsistent rollback chains.

2. **Fork resolution** (`core/fork.ts:34`) — `resolveForkCursor()` uses `finalized` as a hard lower bound. If the persisted finalized number is higher than the newly received one, the boundary becomes stale and fork resolution can't roll back to legitimate blocks.

3. **Rollback chain extraction** (`core/portal-source.ts:82-91`) — `extractRollbackChain()` filters blocks where `b.header.number > head.number` (head = finalized). A lower finalized number means more blocks get included in the rollback chain than expected.

4. **State persistence** — All three target backends (Postgres, ClickHouse, Memory) store the finalized head value directly from the batch context. A regressed finalized number overwrites the correct (higher) value, corrupting the state boundary.

5. **Cleanup logic** (`postgres-state.ts:147-149`) — A lower finalized number shifts the cleanup boundary backwards, potentially creating gaps in rollback history.

6. **Portal cache** (`node-portal-cache.ts:102-109`) — A lower finalized head means fewer blocks get cached (benign — just a missed caching opportunity).

## Goals

- **Ensure the SDK enforces monotonically non-decreasing finalized head within each stream session** — the guard clamps incoming finalized values to `max(incoming, previousHighest)`.
- **Minimal blast radius** — the fix should be a narrow, well-tested guard.
- **No API changes** — we cannot modify the Portal API behavior.
- **Log when clamping occurs** — to help diagnose Portal API instability.

## Non-goals

- Diagnosing *why* the Portal API returns regressed finalization numbers.
- Adding retry/reconnect logic.
- Cross-stream monotonicity enforcement (see Assumptions section for why).
- Feature flags or kill switches (the fix is strictly safe — clamping to max is correct by definition).

## Alternatives considered

### Alternative 1: Guard at the `StreamBuffer.put()` level
Apply `max(current, incoming)` to the finalized head inside `StreamBuffer.put()`.

**Pros:** Single enforcement point.  
**Cons:** `StreamBuffer` is a generic buffer. Adding blockchain-specific finalization logic violates its responsibility. Also requires tracking state in a class that currently has no domain knowledge.

### Alternative 2: Guard at block-splitting site only
Apply the `max()` guard at `client.ts:302` where `res.head.finalized` is used for partitioning.

**Pros:** Fixes the most visible symptom.  
**Cons:** The head also propagates to `buffer.put()` and flows to all downstream consumers. We'd need additional guards at every consumption site — fragile and error-prone.

### Alternative 3: Guard inside `createPortalStream()` before any consumption (chosen)
Track a high-water mark scoped to each `createPortalStream()` invocation. Before the head is used for *anything* — block splitting, buffer pushing, or downstream propagation — clamp it.

**Pros:**
- Single enforcement point, applied before all downstream logic.
- No changes to `StreamBuffer`, `PortalSource`, targets, or fork resolution.
- Scoped to stream lifetime (correct — each stream gets its own Portal connection).
- The guard is in `createPortalStream()`, not in `getHeadFromHeaders()`, because: (a) `getHeadFromHeaders` is a pure function that parses headers — it shouldn't carry state; (b) the high-water mark is a stream-scoped concern; (c) `createPortalStream()` already manages mutable state (`fromBlock`, `parentBlockHash`) across iterations.

**Cons:**
- One additional `let` variable in `createPortalStream()`.
- Does not enforce monotonicity across stream restarts (addressed below).

### Alternative 4: Guard at the persistence layer (targets)
Each target's `saveCursor()` would compare `head.finalized` against previously persisted finalized value and take the max.

**Pros:** Protects persisted state directly.  
**Cons:** Requires changes in 3 separate targets (Postgres, ClickHouse, Memory). Doesn't protect the block-splitting logic or rollback chain extraction. Still need to fix the stream-level issue anyway.

### Alternative 5: Do nothing
**Not viable.** Multiple subsystems silently corrupt on finalized regression.

## Chosen direction: Alternative 3

### Hash invariant (Blocker 1 resolution)

When clamping the finalized number, we preserve the **high-water mark's entire `BlockRef`** (both number and hash). Rationale:
- The high-water mark's hash corresponds to the block at the higher finalized number.
- The regressed response's hash corresponds to a lower block — using it with the clamped (higher) number would create a synthetic `BlockRef` that never existed on chain.
- Downstream code (fork resolution, cache) matches on hash, so consistency matters.

In code: when `incoming.number < highWaterMark.number`, we replace the entire `res.head.finalized` with `highWaterMark`, not just the number.

### Cross-stream / restart behavior (Blocker 2 resolution)

The high-water mark resets when a stream restarts (after fork, error, or process restart). This is **by design**:

1. **After a fork:** The SDK deliberately rewinds to a previous cursor. The finalized head at that point may legitimately be lower than before the fork. Carrying over the old high-water mark would prevent the SDK from learning the new finalization state.

2. **After a process restart:** The persisted cursor (`getCursor()`) is used to resume, but the *persisted finalized value* is not used as a high-water mark seed. This is acceptable because:
   - The persisted finalized head was correct at the time it was saved (our guard ensured monotonicity during the stream that saved it).
   - On restart, the Portal API returns the *current* finalized head. Even if it's lower than the persisted value, the **persisted state's cleanup boundary was already calculated using the higher value**, so no data loss occurs retroactively.
   - The next stream session will build a new high-water mark that increases from whatever the Portal API provides.
   - The already-persisted rollback records still have their correct `finalized` field from when they were saved — fork resolution uses *per-record* finalized values, not a global one.

3. **Self-healing for existing corrupted state (Blocker 4 resolution):** If a user's persisted finalized value is already regressed (from before this fix):
   - **Fork resolution:** Uses per-record `finalized` from the DB. Records saved before the regression have correct finalized values. Records saved during the regression window have lower values, but this only means fork resolution has a looser boundary (can roll back further), which is safe — it's conservative.
   - **Cleanup:** May retain slightly more rows than necessary (the `safeBlockNumber` calculation uses `min(current, finalized)`). This self-corrects as new records with correct finalized values accumulate.
   - **No migration needed.** The state self-heals as new data flows through with the fix in place.

### Implementation sketch

```typescript
// Inside createPortalStream(), before the while loop:
let finalizedHighWaterMark: BlockRef | undefined

// After each requestStream() call, before any consumption of res.head:
if (res.head.finalized) {
  if (finalizedHighWaterMark && res.head.finalized.number < finalizedHighWaterMark.number) {
    // Portal returned a regressed finalized head — clamp to high-water mark
    res.head = { ...res.head, finalized: finalizedHighWaterMark }
  } else {
    finalizedHighWaterMark = res.head.finalized
  }
}
```

Note: we spread `res.head` to avoid mutating the original object.

### Where this applies in the code flow

Both paths through `createPortalStream()` use `res.head`:
1. **204 path** (line 260): `buffer.put({ blocks: [], head: res.head, ... })` — head-only update, no blocks. The guard ensures even head-only updates don't regress.
2. **200 path** (lines 302-336): Block splitting + buffer push. The guard ensures correct partitioning and correct head in buffer.

## Architecture sketch

```
Portal API Response
  |
  v
getHeadFromHeaders()    -- pure function, extracts raw finalized head from HTTP headers
  |
  v
createPortalStream()    -- [GUARD HERE] clamp finalized to max(incoming, highWaterMark)
  |                        replaces entire BlockRef when clamping (preserves hash invariant)
  |
  +---> 204 path: buffer.put({ blocks: [], head: guardedHead })
  |
  +---> 200 path: partition blocks by guardedHead.finalized.number
  |       |
  |       +---> buffer.put(finalizedBlocks, head: guardedHead)
  |       +---> buffer.put(unfinalizedBlocks, head: guardedHead, flushImmediate=true)
  |
  v
StreamBuffer --> PortalSource.read() --> BatchContext.stream.head.finalized
                                              |
                                              +---> extractRollbackChain() (uses head.finalized)
                                              +---> Target.write()
                                                      +---> saveCursor() (persists correct finalized)
                                                      +---> fork() (uses per-record finalized)
```

## Assumptions and unknowns

1. **Assumption:** The Portal API's finalization regression is transient (load balancer routing to nodes with different views). If persistent, the SDK will clamp continuously but still function correctly.
2. **Assumption:** A stream restart is an acceptable reset point for the high-water mark (justified above).
3. **Assumption:** The `res.head` object from `requestStream()` is not shared or cached — safe to replace properties. (Verified: it's constructed fresh in `getHeadFromHeaders()` on each response.)
4. **Unknown:** How often does the regression happen? We should log a warning when clamping occurs.
5. **Unknown:** Can the finalized hash regress independently of the number (same number, different hash)? This would indicate a deeper chain inconsistency. Our guard only triggers on number regression, not hash changes at the same number. This is acceptable — hash-only changes at the same finalized number would be a far more serious Portal bug that we can't reasonably guard against.

## Blast radius / rollback story

- **Blast radius:** One `let` variable and one `if` block inside `createPortalStream()`. No public API changes, no type changes, no config changes. No changes to any other file.
- **Rollback:** Revert the single commit. No migration needed.
- **Risk of the fix:** If the Portal API intentionally sends a lower finalized number (e.g., deep reorg), clamping prevents the SDK from learning about it within the current stream. However, the current SDK architecture treats finalization as immutable anyway (fork.ts:34 returns null for blocks below finalized). The guard makes the failure mode "stale finalized head" instead of "corrupt state", which is strictly better. A stream restart (which happens on fork) resets the high-water mark, allowing the new finalized state to propagate.
