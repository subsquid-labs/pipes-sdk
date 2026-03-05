# RFC: Delta DB

**Status:** Draft
**Authors:** TBD
**Created:** 2026-03-05

## 1. Summary

Delta DB is an embedded, rollback-aware computation engine that sits between a blockchain data source (Portal) and a downstream target database (Postgres, ClickHouse, etc.). It maintains incremental materialized views over streaming blockchain data, handles chain reorganizations (rollbacks) in a single place, and emits minimal delta records to downstream targets — eliminating the need for each target to implement its own rollback and aggregation logic.

## 2. Problem Statement

### Current pain points

1. **Rollback logic is duplicated per target.** Every target (ClickHouse, Postgres, queues) needs its own rollback implementation. This is error-prone and expensive to maintain.

2. **Some aggregations are not rollback-safe.** ClickHouse materialized views support `sum` rollbacks via `SummingMergeTree`, but `first`, `last`, `avg`, and `median` cannot be rolled back once committed.

3. **Queue targets cannot rollback at all.** Once a message is published, it cannot be retracted. Downstream consumers receive inconsistent data during reorgs.

4. **Aggregation state is fragile.** The current `Aggregator` in Pipes SDK stores unfinalized values as arrays in SQLite. This doesn't scale to deep reorgs or high-cardinality group-by keys.

5. **Stateful computations (PnL, running balances) are impossible with current aggregators.** The existing `sum`/`min`/`max`/`first`/`last` functions treat each row independently. PnL requires reading accumulated state (position, cost basis) to compute each trade's contribution — a sequential fold, not a commutative aggregate.

6. **No standard way to define derived tables.** Materialized views are implemented ad-hoc per use case with no shared schema or optimization.

### What Delta DB solves

- **Single rollback implementation** — Delta DB is the only component that handles rollbacks. Downstream targets receive clean deltas (inserts, updates, deletes) and never need to reason about chain forks.
- **Correct incremental aggregations** — Materialized views properly separate finalized and unfinalized state, supporting all aggregation types including `first`, `last`, and `avg`.
- **Stateful computation** — Reducers enable sequential fold operations like PnL, running balances, and position tracking with full rollback support.
- **Minimal downstream writes** — Delta DB computes diffs and emits only changed rows, reducing write amplification on the target database.
- **Backpressure with eager merging** — When the downstream target is slow, Delta DB continues to accept and merge incoming batches, reducing the total number of flushes needed.
- **Language-agnostic** — Schema is defined in SQL DDL. The engine is a Rust core. Host language SDKs (TypeScript, Python, etc.) are thin bindings.

## 3. Architecture

### 3.1 High-level data flow

```
Portal (source)
    |
    v
Host SDK (decode, transform)   ← TypeScript, Python, etc.
    |
    v
+-----------------------------------------------+
|                 Delta DB (Rust)                |
|                                                |
|  +----------+   +-----------+   +-----------+  |
|  |Raw Tables|-->| Reducers  |-->|Aggregate  |  |
|  |          |-->|(stateful) |   |    MVs    |  |
|  +----------+   +-----------+   +-----------+  |
|       |              |               |         |
|       v              v               v         |
|                Delta Buffer                    |
+-----------------------------------------------+
    |
    v  (delta records: insert / update / delete)
Target DB (Postgres, ClickHouse, Kafka, ...)
```

### 3.2 Three types of objects

| Type | Purpose | State | Rollback strategy |
|------|---------|-------|-------------------|
| **Raw Table** | Store incoming rows | Append-only per block | Delete rows where `block_number > fork_point` |
| **Reducer** | Stateful row enrichment (PnL, balances) | Keyed mutable state (per group) | Restore finalized state, replay unfinalized rows |
| **Aggregate MV** | GROUP BY aggregation (volume, counts) | Per-group accumulators | Remove rolled-back block contributions |

The DAG: `Raw Table` -> `Reducer` (optional) -> `Aggregate MV` (optional)

A reducer reads from a raw table, enriches each row with computed columns, and feeds into aggregate MVs. This separation keeps each layer simple: reducers handle stateful logic, aggregate MVs handle windowed rollback-safe aggregations.

### 3.3 Deployment model

Delta DB is an **embedded library** — a Rust engine with host language bindings (napi-rs for Node.js, PyO3 for Python, etc.). It runs in the same process as the host application. No separate service to deploy.

> **Note:** If we later need a standalone mode (e.g., shared across multiple pipelines), the Rust core can be extracted into a separate process with a gRPC/Unix socket interface. The engine design should not assume embedding.

### 3.4 Integration with host SDKs

Delta DB exposes itself as a target that wraps a single downstream target. Example in TypeScript (Pipes SDK):

```typescript
const deltaDb = new DeltaDB({
  storage: './data/delta-db',
  schema: './schema.sql',       // SQL DDL file (language-agnostic)
  target: clickhouseTarget,
})

source.pipe(decoder).pipeTo(deltaDb)
```

Example in Python:

```python
delta_db = DeltaDB(
    storage="./data/delta-db",
    schema="./schema.sql",
    target=clickhouse_target,
)
source.pipe(decoder).pipe_to(delta_db)
```

The schema file is the same in both cases — a `.sql` file parsed by the Rust engine.

> **Why a single target?** Data (raw rows, reducer snapshots, MV unfinalized state) can only be pruned after it has been **both finalized and acknowledged by the downstream target**. Multiple targets with independent cursors means the slowest target dictates pruning — a stalled target causes unbounded disk growth. A single target keeps the cursor/pruning model simple. For fan-out, use an external broker (Delta DB -> Kafka -> multiple consumers).

### 3.5 Backpressure model

```
Source  --batch-->  Delta DB  --delta-->  Target DB
                      |                      |
                      |<------ack------------|
                      |
              (merge incoming batches
               while waiting for ack)
```

1. Delta DB accepts a batch from the source and immediately updates its internal raw tables, reducers, and MVs.
2. It then attempts to flush the computed deltas to the downstream target.
3. If the downstream has not acknowledged the previous flush, Delta DB continues accepting and merging incoming batches internally.
4. When the downstream acks, Delta DB flushes the accumulated delta (which may now represent multiple merged batches — reducing write amplification).
5. The source is only backpressured if Delta DB's internal buffer exceeds a configurable memory limit.

## 4. Schema Definition

### 4.1 Approach

Schemas are defined in **SQL DDL** — the canonical, language-agnostic format. The Rust engine parses and validates the schema at startup. Host language SDKs load the schema from a `.sql` file or string.

Tables and aggregate MVs use standard SQL syntax (close to ClickHouse/Materialize). Reducers require new syntax for defining stateful process logic — explored in detail in Section 5.

### 4.2 Tables and MVs: SQL syntax

```sql
CREATE TABLE swaps (
    block_number UInt64,
    block_time   DateTime,
    user         String,
    pool         String,
    token_in     String,
    token_out    String,
    amount_in    Float64,
    amount_out   Float64,
    price        Float64
);

CREATE MATERIALIZED VIEW volume_5m AS
  SELECT
    pool,
    toStartOfInterval(block_time, INTERVAL 5 MINUTE) AS window_start,
    sum(amount_in)  AS volume_in,
    sum(amount_out) AS volume_out,
    count()         AS swap_count,
    max(amount_in)  AS max_swap
  FROM swaps
  GROUP BY pool, window_start;
```

This is standard — no design controversy here. The interesting question is how to define **reducers**.

### 4.3 Column types (PoC)

| Type | Description |
|------|-------------|
| `UInt64` | Unsigned 64-bit integer |
| `Int64` | Signed 64-bit integer |
| `Float64` | 64-bit floating point |
| `String` | UTF-8 string |
| `DateTime` | Timestamp (milliseconds) |
| `Boolean` | Boolean |
| `Bytes` | Arbitrary byte array |

### 4.4 Rollback key

The **rollback key is always `block_number`** — it is implicit and does not need to be declared by the user. Every raw table row is associated with the block number it was produced from. This is the fundamental unit of rollback: "undo everything from block N onward."

## 5. Reducers — Stateful Computation

### 5.1 The problem: why aggregations aren't enough

Consider tracking PnL for a trader. Alice makes three trades:

```
Block 1000: BUY  10 ETH @ $2000
Block 1001: BUY   5 ETH @ $2100
Block 1002: SELL  8 ETH @ $2200
```

To compute the PnL on the sell, you need the **average cost basis**, which depends on the accumulated position from all prior buys:

```
After block 1000: qty=10, cost_basis=$20,000, avg_cost=$2,000
After block 1001: qty=15, cost_basis=$30,500, avg_cost=$2,033.33
After block 1002: trade_pnl = 8 * ($2,200 - $2,033.33) = $1,333.33
                  qty=7, cost_basis=$14,233.33
```

This **cannot** be expressed as `sum()`, `max()`, or any commutative aggregate because:
- Each row's output depends on accumulated state from all prior rows
- The state update is order-dependent (FIFO cost basis)
- You need to read `avg_cost` before you can compute `trade_pnl`

This is a **sequential fold** — a fundamentally different primitive from aggregation.

### 5.2 Solution: Reducers

A **reducer** is a stateful transformation that:
1. Maintains **keyed state** — one state object per group key (e.g., per user+token pair)
2. Processes rows **in block order** — for each row, reads current state, computes output, updates state
3. Emits **enriched rows** — original row columns + computed columns
4. Is **rollback-safe** — state can be restored to any block boundary

```
Raw Table (trades)
    |  row: { user, token, side, amount, price }
    v
Reducer (position_tracker)
    |  state per (user, token): { quantity, cost_basis }
    |  enriched row: { ...original, trade_pnl, position_size, avg_cost }
    v
Aggregate MV (pnl_5m)
    |  GROUP BY user, token, window_5m
    |  sum(trade_pnl), count(), sum(amount)
    v
Delta Output
```

The key insight: **the reducer computes per-trade PnL, and the aggregate MV just sums it**. The MV doesn't know anything about position tracking — it's a simple `sum()`. All the stateful complexity lives in the reducer.

### 5.3 Reducer syntax options

The challenge: reducers are fundamentally **imperative** (read state, branch, mutate state), which clashes with SQL's declarative nature. Below are the options explored, using the PnL use case throughout.

---

#### Option A: SQL Expressions with CASE (declarative)

Express everything as column-level expressions. No control flow — branching via `CASE`. State transitions are declared as `SET` assignments.

```sql
CREATE REDUCER pnl_tracker
  SOURCE swaps
  GROUP BY user, token_in
  STATE (
    quantity   Float64 DEFAULT 0,
    cost_basis Float64 DEFAULT 0
  )
  LET
    avg_cost = IF(state.quantity > 0, state.cost_basis / state.quantity, 0),
    is_sell  = row.amount_in > 0
  SET
    state.quantity   = state.quantity + CASE WHEN is_sell THEN -row.amount_in ELSE row.amount_out END,
    state.cost_basis = CASE
      WHEN is_sell THEN state.cost_basis - row.amount_in * avg_cost
      ELSE state.cost_basis + row.amount_out * row.price
    END
  EMIT
    CASE WHEN is_sell THEN row.amount_in * (row.price - avg_cost) ELSE 0 END AS trade_pnl,
    state.quantity AS position_size,
    avg_cost;
```

**Structure:** `LET` (computed locals) -> `SET` (state mutations) -> `EMIT` (output columns)

| Pros | Cons |
|------|------|
| Purely declarative — each expression stands alone | Complex logic creates deeply nested `CASE` trees |
| Easy to parse — it's just expressions, no control flow | Reading order matters (`LET` must come first) |
| Can be compiled to Rust/WASM efficiently | Less intuitive for developers used to imperative code |
| Familiar SQL expression syntax | Multiple branches repeat the same `CASE WHEN is_sell` pattern |

**Best for:** Simple to medium reducers. Starts to degrade for complex multi-branch logic.

---

#### Option B: Event-style rules (pattern matching)

Inspired by CEP (Complex Event Processing) systems. Define `WHEN` blocks that match row patterns, each with its own state updates and emissions.

```sql
CREATE REDUCER pnl_tracker
  SOURCE swaps
  GROUP BY user, token_in
  STATE (
    quantity   Float64 DEFAULT 0,
    cost_basis Float64 DEFAULT 0
  )

  WHEN row.amount_in > 0 THEN   -- sell
    LET avg_cost = state.cost_basis / state.quantity
    SET state.quantity   = state.quantity - row.amount_in,
        state.cost_basis = state.cost_basis - row.amount_in * avg_cost
    EMIT trade_pnl = row.amount_in * (row.price - avg_cost)

  WHEN row.amount_out > 0 THEN  -- buy
    SET state.quantity   = state.quantity + row.amount_out,
        state.cost_basis = state.cost_basis + row.amount_out * row.price
    EMIT trade_pnl = 0

  ALWAYS EMIT
    state.quantity AS position_size,
    IF(state.quantity > 0, state.cost_basis / state.quantity, 0) AS avg_cost;
```

**Structure:** Multiple `WHEN` blocks (first match wins) + `ALWAYS EMIT` for columns emitted regardless of branch.

| Pros | Cons |
|------|------|
| Very readable — each "event type" is self-contained | Novel syntax — no existing SQL standard to lean on |
| No nesting — flat structure even for complex logic | Ambiguous semantics: does `state` in `EMIT` see pre- or post-`SET` values? |
| Natural fit for blockchain events (different tx types) | `WHEN` ordering matters (first match? all matches?) |
| Easy to extend — add a new branch without touching others | Harder to compile — need to handle overlapping conditions |

**Best for:** Reducers where rows have clear "types" (buy/sell, mint/burn, deposit/withdraw) — extremely common in blockchain.

**Semantic choices needed:**
- `WHEN` evaluation: first match, or all matching? → Recommend **first match** (like SQL `CASE`).
- `EMIT` sees post-`SET` state? → Recommend **yes** — `EMIT` runs after `SET` within each `WHEN` block.
- What if no `WHEN` matches? → Row passes through with `ALWAYS EMIT` columns only. If no `ALWAYS EMIT`, row is dropped.

---

#### Option C: Embedded Lua

Use a real, embeddable language inside the SQL definition. Lua is tiny, sandboxed, fast, and trivially embeddable in Rust via `mlua`.

```sql
CREATE REDUCER pnl_tracker
  SOURCE swaps
  GROUP BY user, token_in
  STATE (
    quantity   Float64 DEFAULT 0,
    cost_basis Float64 DEFAULT 0
  )
  LANGUAGE lua
  PROCESS $$
    local avg_cost = state.quantity > 0 and state.cost_basis / state.quantity or 0

    if row.amount_in > 0 then
      -- sell
      emit.trade_pnl = row.amount_in * (row.price - avg_cost)
      state.quantity = state.quantity - row.amount_in
      state.cost_basis = state.cost_basis - row.amount_in * avg_cost
    else
      -- buy
      emit.trade_pnl = 0
      state.quantity = state.quantity + row.amount_out
      state.cost_basis = state.cost_basis + row.amount_out * row.price
    end

    emit.position_size = state.quantity
    emit.avg_cost = avg_cost
  $$;
```

| Pros | Cons |
|------|------|
| Real language — no custom parser needed | Another language in the stack |
| Fully expressive: loops, functions, complex logic | Lua is niche — many developers don't know it |
| Fast: LuaJIT-level performance for numerical computation | Harder to statically analyze/optimize |
| Sandboxed: no I/O, no OS access by default | Debugging story is weaker than host language |
| Proven model: Redis, Nginx, game engines | Type mismatches caught at runtime, not parse time |

**Best for:** Complex reducer logic that pushes beyond what expressions can handle (e.g., FIFO/LIFO position tracking, complex fee structures).

---

#### Option D: WASM process functions

The reducer is compiled to WebAssembly by the user (from Rust, Go, AssemblyScript, etc.) and referenced by the schema.

```sql
CREATE REDUCER pnl_tracker
  SOURCE swaps
  GROUP BY user, token_in
  STATE (
    quantity   Float64 DEFAULT 0,
    cost_basis Float64 DEFAULT 0
  )
  LANGUAGE wasm
  MODULE 'pnl_tracker.wasm'     -- compiled from Rust, Go, AssemblyScript, etc.
  PROCESS 'process_trade';      -- exported function name
```

The WASM module implements a known interface:

```rust
// Rust example compiled to WASM
#[no_mangle]
pub fn process_trade(state: &mut State, row: &Row, emit: &mut Emit) {
    let avg_cost = if state.quantity > 0.0 {
        state.cost_basis / state.quantity
    } else {
        0.0
    };

    if row.amount_in > 0.0 {
        emit.trade_pnl = row.amount_in * (row.price - avg_cost);
        state.quantity -= row.amount_in;
        state.cost_basis -= row.amount_in * avg_cost;
    } else {
        emit.trade_pnl = 0.0;
        state.quantity += row.amount_out;
        state.cost_basis += row.amount_out * row.price;
    }

    emit.position_size = state.quantity;
    emit.avg_cost = avg_cost;
}
```

| Pros | Cons |
|------|------|
| Maximum performance — near-native speed | High barrier to entry: compile step, toolchain setup |
| Write in any language that compiles to WASM | WASM debugging is painful |
| Fully sandboxed | Schema split across SQL + binary artifact |
| Future-proof — WASM ecosystem is growing fast | Harder to iterate/prototype than interpreted languages |
| Can be verified/audited (deterministic execution) | State serialization across WASM boundary needs design |

**Best for:** Production-grade, performance-critical reducers. Not ideal for prototyping.

---

#### Option E: Imperative DSL (PL/pgSQL-style)

A custom procedural mini-language inside `$$` delimiters, similar to PL/pgSQL or ClickHouse UDFs.

```sql
CREATE REDUCER pnl_tracker
  SOURCE swaps
  GROUP BY user, token_in
  STATE (
    quantity   Float64 DEFAULT 0,
    cost_basis Float64 DEFAULT 0
  )
  PROCESS $$
    avg_cost := IF(state.quantity > 0, state.cost_basis / state.quantity, 0);
    IF row.amount_in > 0 THEN
      trade_pnl := row.amount_in * (row.price - avg_cost);
      state.quantity -= row.amount_in;
      state.cost_basis -= row.amount_in * avg_cost;
    ELSE
      trade_pnl := 0;
      state.quantity += row.amount_out;
      state.cost_basis += row.amount_out * row.price;
    END IF;
    EMIT trade_pnl, state.quantity AS position_size, avg_cost;
  $$;
```

| Pros | Cons |
|------|------|
| Expressive — handles any logic | Requires building a full parser + interpreter (or compiler) |
| Familiar to PL/pgSQL users | Custom language = custom bugs, custom docs, custom learning curve |
| Self-contained in SQL file | Hard to get right: scoping, type coercion, error messages |
| Can be compiled to WASM or native code | Developers will want features (loops, functions, arrays) — scope creep |

**Best for:** If we want a fully self-contained SQL-based experience. But this is effectively building a new programming language.

---

### 5.4 Syntax comparison summary

| | A: SQL Expressions | B: Event Rules | C: Lua | D: WASM | E: Imperative DSL |
|---|---|---|---|---|---|
| **Complexity to build** | Low | Medium | Low (use mlua) | Medium | High |
| **Readability** | Medium | High | High | N/A (external) | Medium |
| **Expressiveness** | Medium | Medium | High | High | High |
| **Performance** | High (compilable) | High (compilable) | High (LuaJIT) | Highest | Medium-High |
| **Learning curve** | Low (SQL users) | Low | Medium (new lang) | High (toolchain) | Medium |
| **Blockchain fit** | OK | Excellent | Good | Good | OK |
| **Static analysis** | Full | Full | None | Partial | Partial |
| **Self-contained** | Yes | Yes | Yes | No (.wasm file) | Yes |

### 5.5 Recommendation: layered approach

These options are **not mutually exclusive**. They address different points on the simplicity/power spectrum:

```
Simple                                              Complex
  |                                                    |
  v                                                    v
SQL Expressions (A)  →  Event Rules (B)  →  Lua (C) / WASM (D)
  |                       |                    |
  trivial reducers        most blockchain      custom algorithms,
  (running balance)       use cases            HFT PnL, FIFO/LIFO
```

**PoC:** Implement **Option B (Event Rules)** as the primary syntax. It hits the sweet spot for blockchain use cases (buy/sell, mint/burn, etc.), is readable, parseable without building a full language, and is self-contained in SQL.

**PoC also:** Implement **Option C (Lua)** as an escape hatch for complex logic that doesn't fit event rules. Lua embedding in Rust is trivial (mlua crate, ~200 lines of glue). This gives us full expressiveness day one without building a custom language.

**GA:** Add **Option D (WASM)** for production performance. Add **Option A (SQL Expressions)** as syntactic sugar for simple cases.

**Defer:** Option E (Imperative DSL) — the cost of building/maintaining a custom language outweighs the benefit when Lua and WASM cover the same ground.

### 5.6 Walkthrough: PnL end-to-end

Using Event Rules (Option B) syntax:

**Schema:**

```sql
CREATE TABLE trades (
    block_number UInt64,
    block_time   DateTime,
    user         String,
    token        String,
    side         String,
    amount       Float64,
    price        Float64
);

CREATE REDUCER pnl_tracker
  SOURCE trades
  GROUP BY user, token
  STATE (
    quantity   Float64 DEFAULT 0,
    cost_basis Float64 DEFAULT 0
  )

  WHEN row.side = 'buy' THEN
    SET state.quantity   = state.quantity + row.amount,
        state.cost_basis = state.cost_basis + row.amount * row.price
    EMIT trade_pnl = 0

  WHEN row.side = 'sell' THEN
    LET avg_cost = state.cost_basis / state.quantity
    SET state.quantity   = state.quantity - row.amount,
        state.cost_basis = state.cost_basis - row.amount * avg_cost
    EMIT trade_pnl = row.amount * (row.price - avg_cost)

  ALWAYS EMIT
    state.quantity AS position_size,
    IF(state.quantity > 0, state.cost_basis / state.quantity, 0) AS avg_cost;

CREATE MATERIALIZED VIEW pnl_5m AS
  SELECT
    user, token,
    toStartOfInterval(block_time, INTERVAL 5 MINUTE) AS window_start,
    sum(trade_pnl)  AS realized_pnl,
    count()          AS trade_count,
    sum(amount)      AS volume
  FROM pnl_tracker
  GROUP BY user, token, window_start;

CREATE MATERIALIZED VIEW positions AS
  SELECT
    user, token,
    last(position_size)   AS position_size,
    last(avg_cost)        AS avg_cost,
    sum(trade_pnl)        AS total_realized_pnl
  FROM pnl_tracker
  GROUP BY user, token;
```

**Input: 3 trades across 3 blocks**

| block | user  | token | side | amount | price |
|-------|-------|-------|------|--------|-------|
| 1000  | alice | ETH   | buy  | 10     | 2000  |
| 1001  | alice | ETH   | buy  | 5      | 2100  |
| 1002  | alice | ETH   | sell | 8      | 2200  |

**Reducer state evolution for key `(alice, ETH)`:**

| After block | quantity | cost_basis | avg_cost |
|-------------|----------|------------|----------|
| 1000        | 10       | 20,000     | 2,000.00 |
| 1001        | 15       | 30,500     | 2,033.33 |
| 1002        | 7        | 14,233.33  | 2,033.33 |

**Reducer output (enriched rows):**

| block | user  | token | side | amount | price | trade_pnl | position_size | avg_cost |
|-------|-------|-------|------|--------|-------|-----------|---------------|----------|
| 1000  | alice | ETH   | buy  | 10     | 2000  | 0         | 10            | 2,000.00 |
| 1001  | alice | ETH   | buy  | 5      | 2100  | 0         | 15            | 2,033.33 |
| 1002  | alice | ETH   | sell | 8      | 2200  | 1,333.33  | 7             | 2,033.33 |

**Aggregate MV `pnl_5m` output (assuming all in same 5m window):**

| user  | token | window_start | realized_pnl | trade_count | volume |
|-------|-------|-------------|--------------|-------------|--------|
| alice | ETH   | 12:00       | 1,333.33     | 3           | 23     |

**Aggregate MV `positions` output:**

| user  | token | position_size | avg_cost | total_realized_pnl |
|-------|-------|---------------|----------|-------------------|
| alice | ETH   | 7             | 2,033.33 | 1,333.33          |

**Delta records emitted to downstream:**
```
INSERT trades (block=1000, user=alice, token=ETH, side=buy, amount=10, price=2000)
INSERT trades (block=1001, user=alice, token=ETH, side=buy, amount=5, price=2100)
INSERT trades (block=1002, user=alice, token=ETH, side=sell, amount=8, price=2200)
UPSERT pnl_5m (user=alice, token=ETH, window=12:00, realized_pnl=1333.33, ...)
UPSERT positions (user=alice, token=ETH, position_size=7, avg_cost=2033.33, ...)
```

### 5.7 Rollback scenario

Now suppose block 1002 gets rolled back (reorg), and a new block 1002' arrives with a different trade:

```
Block 1002' (replaces 1002): alice SELLS 3 ETH @ $1900
```

**Rollback steps:**

1. **Identify fork point:** block 1001 (last common ancestor)

2. **Roll back raw table:** delete trade row for block 1002

3. **Roll back reducer state:**
   - Load finalized state for `(alice, ETH)`. If block 1001 is finalized: `{qty: 15, cost_basis: 30500}`.
   - If block 1001 is NOT finalized: load last finalized state + replay unfinalized blocks up to 1001 through the reducer.
   - Result: state is back to `{qty: 15, cost_basis: 30500, avg_cost: 2033.33}`

4. **Process new block 1002':**
   - `trade_pnl = 3 * (1900 - 2033.33) = -400`  (a loss this time)
   - `qty = 12, cost_basis = 24400`

5. **Update aggregate MVs:**
   - `pnl_5m`: realized_pnl was 1333.33, now becomes -400. Emit `UPDATE`.
   - `positions`: position_size was 7, now 12. Emit `UPDATE`.

6. **Delta records emitted:**
   ```
   DELETE trades WHERE block_number = 1002
   INSERT trades (block=1002, user=alice, token=ETH, side=sell, amount=3, price=1900)
   UPDATE pnl_5m SET realized_pnl=-400, trade_count=3, volume=18 WHERE ...
   UPDATE positions SET position_size=12, avg_cost=2033.33, total_realized_pnl=-400 WHERE ...
   ```

### 5.8 Reducer rollback internals

Reducers store state with **per-block snapshots** for the unfinalized window:

```
Storage layout for reducer state key (alice, ETH):

  finalized_state:  { qty: 15, cost_basis: 30500 }   <- at finalized block 1001
  unfinalized_log:
    block 1002: { qty: 12, cost_basis: 24400 }        <- snapshot after processing block
    block 1003: { qty: 12, cost_basis: 24400 }        <- (no trades in this block for alice/ETH)
    ...
```

Two rollback strategies, configurable per reducer:

| Strategy | How it works | Tradeoff |
|----------|-------------|----------|
| **Snapshot** (default) | Store state snapshot after each block. Rollback = restore snapshot at fork point. | Fast rollback, higher storage (one snapshot per block per active group key) |
| **Replay** | Only store finalized state. Rollback = restore finalized state + replay raw rows from finalized+1 to fork point through the reducer. | Minimal storage, slower rollback (proportional to unfinalized window size) |

For most chains (75 unfinalized blocks on Ethereum), **snapshot** is practical. For chains with very long finality or very high cardinality group keys, **replay** saves storage at the cost of rollback latency.

On **finalization** (block F becomes finalized):
1. State at block F becomes the new `finalized_state`
2. Discard all snapshots for blocks <= F
3. The unfinalized window shrinks

### 5.9 Reducer execution model

The Rust engine manages storage, rollback, snapshot management, and delta computation. The reducer process logic runs in one of several runtimes:

```
                         +-----------------+
                         |   Rust Engine    |
                         | (storage, state, |
                         |  rollback, delta)|
                         +--------+--------+
                                  |
                    +-------------+-------------+
                    |             |              |
              Event Rules     Lua VM        WASM Runtime
              (compiled)     (mlua)         (wasmtime)
```

**Performance expectations:**

| Runtime | Throughput | Startup | Best for |
|---------|-----------|---------|----------|
| Event Rules (compiled) | >200K rows/sec | Instant | Standard blockchain patterns |
| Lua | >100K rows/sec | Instant | Complex imperative logic |
| WASM | >200K rows/sec | ~50ms | Production-grade, performance-critical |

For all runtimes, the hot path (state reads/writes, snapshot management, delta computation) remains in Rust. The reducer process function is called per-row via the selected runtime.

## 6. Aggregate Materialized Views

### 6.1 Aggregation functions

**PoC:**

| Function | Rollback-safe | Notes |
|----------|:---:|-------|
| `sum(col)` | Yes | Finalized value + sum of unfinalized values |
| `count()` | Yes | Finalized count + count of unfinalized |
| `min(col)` | Yes | Recomputed from finalized min + unfinalized values |
| `max(col)` | Yes | Recomputed from finalized max + unfinalized values |
| `avg(col)` | Yes | Stored as `(sum, count)` internally; avg = sum/count |
| `first(col)` | Yes | Finalized value takes priority; unfinalized only if no finalized |
| `last(col)` | Yes | Latest unfinalized value; falls back to finalized |

**GA additions:** `median(col)`, `quantile(col, p)`, `count_distinct(col)`

### 6.2 MV rollback strategy

Each aggregation function stores enough state to support rollback:

| Function | Finalized state | Unfinalized state | Rollback strategy |
|----------|----------------|-------------------|-------------------|
| `sum` | Running sum | Per-block partial sums | Subtract rolled-back blocks |
| `count` | Running count | Per-block counts | Subtract rolled-back blocks |
| `min` | Global min | Per-block min values | Recompute min from remaining |
| `max` | Global max | Per-block max values | Recompute max from remaining |
| `avg` | `(sum, count)` | Per-block `(sum, count)` | Subtract, recompute ratio |
| `first` | First value (immutable once finalized) | Per-block first candidates | Drop rolled-back, pick earliest remaining |
| `last` | Latest finalized value | Per-block last values | Drop rolled-back, pick latest remaining |

Key: unfinalized aggregation state is stored **per block number**, not as a flat array. This allows surgical rollback to any block without replaying all unfinalized data.

### 6.3 Time windowing

**Window functions (PoC):**

| Function | Description |
|----------|-------------|
| `toStartOfInterval(col, interval)` | Truncate timestamp to interval boundary (5m, 1h, 1d, etc.) |

**Block time vs block number:**
- Block number is the offset / rollback key (monotonic, integral)
- Block time (timestamp) is used for time-based windowing but is NOT guaranteed to be monotonic
- Windows are keyed by truncated block time, but rollback granularity is block number
- A single time window may contain rows from many block numbers

**Window rollback:**
When a rollback affects a time window (e.g., a 5-minute candle):
1. Identify affected windows by checking which time windows contain blocks > fork cursor
2. For each affected window: remove unfinalized contributions from rolled-back blocks
3. Emit `UPDATE` delta with corrected values (or `DELETE` if window is now empty after rollback)

Edge case: a window spanning the finalized/unfinalized boundary. The finalized portion is immutable; only the unfinalized portion gets rolled back.

## 7. Internal Storage

### 7.1 Storage engine

Delta DB uses an embedded key-value store (RocksDB or redb) for its internal state:

| Partition | Contents | Lifecycle |
|-----------|----------|-----------|
| `raw:{table}` | Raw table rows, keyed by `(block_number, row_index)` | Deleted after finalization + downstream ack |
| `reducer:{name}:{group_key}` | Reducer state snapshots per block | Finalized state retained; unfinalized snapshots discarded on finalization |
| `mv:{view}:{group_key}` | MV accumulators (finalized + per-block unfinalized) | Finalized state retained; unfinalized discarded on finalization |
| `meta` | Cursors, rollback chain, finalization height | Persistent |

### 7.2 Data lifecycle

```
Block received (unfinalized)
  -> raw rows stored with block_number key
  -> reducer processes rows, state snapshot stored
  -> MV unfinalized accumulators updated
  -> delta emitted to buffer

Block finalized (height F)
  -> reducer: state at F becomes finalized, discard snapshots <= F
  -> MV: merge unfinalized contributions <= F into finalized accumulators
  -> raw rows <= F eligible for eviction (after downstream ack)

Rollback to block N
  -> delete raw rows where block_number > N
  -> reducer: restore state snapshot at block N (or replay from finalized)
  -> MV: discard unfinalized contributions for blocks > N
  -> emit compensating deltas downstream
```

### 7.3 Unfinalized state bounds

| Chain | Finality | Approx. unfinalized blocks |
|-------|----------|---------------------------|
| Ethereum | ~15 min | ~75 blocks |
| Polygon | ~30 min | ~150 blocks |
| Arbitrum | ~1 hour | ~3600 blocks (1 block/sec) |

Delta DB supports a configurable maximum unfinalized window. If exceeded, a warning is logged but processing continues.

### 7.4 Crash recovery

Delta DB uses a write-ahead log (WAL) for atomicity:

1. Incoming batch writes go to WAL first
2. WAL is applied to storage
3. On crash, replay uncommitted WAL entries
4. Downstream flushes are idempotent (each flush carries a monotonic sequence number; the downstream skips already-applied flushes)

## 8. Delta Output

### 8.1 Delta record format

```
DeltaRecord:
  table:       string               -- raw table, reducer output, or MV name
  operation:   insert | update | delete
  key:         map<string, value>   -- primary key / group key
  values:      map<string, value>   -- full row for insert/update
  prev_values: map<string, value>   -- previous values (optional, for update)

DeltaBatch:
  sequence:        uint64    -- monotonic flush sequence for idempotency
  finalized_block: uint64    -- highest finalized block in this batch
  latest_block:    uint64    -- highest processed block in this batch
  records:         DeltaRecord[]
```

### 8.2 Delta semantics per object type

| Object | Normal processing | Rollback |
|--------|-------------------|----------|
| **Raw table** | `insert` | `delete` for rolled-back rows |
| **Reducer output** | `insert` (enriched rows) | `delete` rolled-back rows + `insert` re-processed rows |
| **Aggregate MV** | `insert` (new key) or `update` (existing key) | `update` with recomputed values, or `delete` if key is empty |

### 8.3 Target adapters

Each downstream target interprets delta records according to its capabilities:

| Target | Insert | Update | Delete |
|--------|--------|--------|--------|
| **ClickHouse** | `INSERT` | `INSERT` (ReplacingMergeTree) or sign flip | Sign = -1 (CollapsingMergeTree) |
| **Postgres** | `INSERT` | `INSERT ... ON CONFLICT UPDATE` | `DELETE` |
| **Kafka** | Produce message | Produce message (with key) | Produce tombstone |

Custom adapters implement:

```
DeltaTarget interface:
  apply(batch: DeltaBatch) -> void
  ack() -> void
```

## 9. Rollback Handling

### 9.1 Complete rollback flow

```
1. Portal detects fork, throws ForkException with previousBlocks
2. Host SDK calls deltaDb.fork(previousBlocks)
3. Delta DB resolves fork cursor via resolveForkCursor() algorithm
4. Delta DB rolls back internal state:
   a. Raw tables: delete rows where block_number > fork_point
   b. Reducers: restore state to fork_point (snapshot or replay)
   c. Aggregate MVs: discard unfinalized contributions > fork_point
5. Delta DB computes compensating delta records
6. Delta DB flushes compensating deltas to downstream targets
7. Delta DB returns fork cursor to host SDK
8. Portal resumes from fork cursor with correct chain data
9. New blocks are processed normally — reducers pick up from restored state
```

### 9.2 Reducer vs MV rollback comparison

| Aspect | Reducer | Aggregate MV |
|--------|---------|--------------|
| What's rolled back | State mutations + enriched rows | Per-block accumulator contributions |
| Strategy | Restore snapshot or replay fold | Subtract/remove contributions |
| Cost | O(1) with snapshots, O(unfinalized_blocks x rows) with replay | O(rolled_back_blocks) |
| State after rollback | Exact state at fork point | Exact accumulators at fork point |

## 10. Quick Example: OHLCV Candles

A minimal example — no reducers, just a raw table and an aggregate MV producing standard OHLCV candles.

```sql
CREATE TABLE trades (
    block_number UInt64,
    block_time   DateTime,
    pair         String,
    price        Float64,
    amount       Float64
);

CREATE MATERIALIZED VIEW candles_5m AS
  SELECT
    pair,
    toStartOfInterval(block_time, INTERVAL 5 MINUTE) AS window_start,
    first(price)  AS open,
    max(price)    AS high,
    min(price)    AS low,
    last(price)   AS close,
    sum(amount)   AS volume,
    count()       AS trade_count
  FROM trades
  GROUP BY pair, window_start;
```

**What happens on rollback:**

Suppose candle `(ETH/USDC, 12:00)` has aggregated 50 trades across blocks 1000-1003. Block 1003 gets rolled back (it contained 3 trades).

1. Delta DB removes the per-block contributions for block 1003 from each accumulator
2. `high`/`low`: recomputed from remaining per-block values (blocks 1000-1002)
3. `first`: unchanged (block 1000 is still present)
4. `last`: falls back to the latest value from block 1002
5. `volume`/`count`: subtract block 1003's partial sum
6. Emit `UPDATE candles_5m SET open=..., high=..., low=..., close=..., volume=..., trade_count=47 WHERE pair='ETH/USDC' AND window_start='12:00'`

The downstream database receives a single corrected row — it never sees the invalid data.

---

## 11. Complete Example: DEX Trading Dashboard

### Use case

Build a dashboard showing per-user, per-token:
- Realized PnL per 5-minute window
- Current open positions
- Volume candles

### Schema file: `schema.sql`

```sql
-- Raw table
CREATE TABLE swaps (
    block_number UInt64,
    block_time   DateTime,
    user         String,
    pool         String,
    token_in     String,
    token_out    String,
    amount_in    Float64,
    amount_out   Float64,
    price        Float64
);

-- Reducer: track position and compute per-swap PnL
CREATE REDUCER pnl_tracker
  SOURCE swaps
  GROUP BY user, token_in
  STATE (
    quantity   Float64 DEFAULT 0,
    cost_basis Float64 DEFAULT 0
  )

  WHEN row.amount_in > 0 THEN   -- sell
    LET avg_cost = state.cost_basis / state.quantity
    SET state.quantity   = state.quantity - row.amount_in,
        state.cost_basis = state.cost_basis - row.amount_in * avg_cost
    EMIT trade_pnl = row.amount_in * (row.price - avg_cost)

  WHEN row.amount_out > 0 THEN  -- buy
    SET state.quantity   = state.quantity + row.amount_out,
        state.cost_basis = state.cost_basis + row.amount_out * row.price
    EMIT trade_pnl = 0

  ALWAYS EMIT
    state.quantity AS position_size,
    IF(state.quantity > 0, state.cost_basis / state.quantity, 0) AS avg_cost;

-- PnL per 5-minute window
CREATE MATERIALIZED VIEW pnl_5m AS
  SELECT
    user, token_in AS token,
    toStartOfInterval(block_time, INTERVAL 5 MINUTE) AS window_start,
    sum(trade_pnl)  AS realized_pnl,
    count()          AS trade_count
  FROM pnl_tracker
  GROUP BY user, token, window_start;

-- Current positions (no time window)
CREATE MATERIALIZED VIEW positions AS
  SELECT
    user, token_in AS token,
    last(position_size)   AS position_size,
    last(avg_cost)        AS avg_cost,
    sum(trade_pnl)        AS total_realized_pnl
  FROM pnl_tracker
  GROUP BY user, token;

-- Volume candles (no reducer needed — pure aggregation from raw table)
CREATE MATERIALIZED VIEW volume_5m AS
  SELECT
    pool,
    toStartOfInterval(block_time, INTERVAL 5 MINUTE) AS window_start,
    sum(amount_in)   AS volume_in,
    sum(amount_out)  AS volume_out,
    count()          AS swap_count,
    max(amount_in)   AS max_swap
  FROM swaps
  GROUP BY pool, window_start;
```

### Host wiring (TypeScript)

```typescript
const deltaDb = new DeltaDB({
  storage: './data/delta-db',
  schema: './schema.sql',
  target: new ClickHouseDeltaTarget({ url: 'http://localhost:8123', database: 'dex' }),
})

await source.pipe(decodeSwaps).pipeTo(deltaDb)
```

### Host wiring (Python)

```python
delta_db = DeltaDB(
    storage="./data/delta-db",
    schema="./schema.sql",
    target=ClickHouseDeltaTarget(url="http://localhost:8123", database="dex"),
)
await source.pipe(decode_swaps).pipe_to(delta_db)
```

### What ClickHouse receives

Delta DB auto-creates these tables in ClickHouse and streams deltas into them:

```sql
-- Raw swaps (append-only from Delta DB's perspective)
CREATE TABLE swaps (...) ENGINE = MergeTree() ORDER BY (block_number);

-- PnL per 5m window (upserted by Delta DB on each flush)
CREATE TABLE pnl_5m (...) ENGINE = ReplacingMergeTree() ORDER BY (user, token, window_start);

-- Current positions (upserted)
CREATE TABLE positions (...) ENGINE = ReplacingMergeTree() ORDER BY (user, token);

-- Volume candles (upserted)
CREATE TABLE volume_5m (...) ENGINE = ReplacingMergeTree() ORDER BY (pool, window_start);
```

ClickHouse doesn't need to know about rollbacks, reducers, or aggregation logic. It just receives clean upserts and deletes.

### Complex reducer example: Lua fallback

If a reducer needs logic beyond what Event Rules can express (e.g., FIFO lot tracking), use Lua:

```sql
CREATE REDUCER fifo_pnl_tracker
  SOURCE trades
  GROUP BY user, token
  STATE (
    lots     String DEFAULT '[]',    -- JSON array of {qty, price} lots
    realized Float64 DEFAULT 0
  )
  LANGUAGE lua
  PROCESS $$
    local lots = json.decode(state.lots)

    if row.side == 'buy' then
      table.insert(lots, { qty = row.amount, price = row.price })
      emit.trade_pnl = 0
    else
      local remaining = row.amount
      local pnl = 0
      while remaining > 0 and #lots > 0 do
        local lot = lots[1]
        local used = math.min(remaining, lot.qty)
        pnl = pnl + used * (row.price - lot.price)
        lot.qty = lot.qty - used
        remaining = remaining - used
        if lot.qty <= 0 then table.remove(lots, 1) end
      end
      state.realized = state.realized + pnl
      emit.trade_pnl = pnl
    end

    state.lots = json.encode(lots)

    local total_qty = 0
    local total_cost = 0
    for _, lot in ipairs(lots) do
      total_qty = total_qty + lot.qty
      total_cost = total_cost + lot.qty * lot.price
    end
    emit.position_size = total_qty
    emit.avg_cost = total_qty > 0 and total_cost / total_qty or 0
  $$;
```

This demonstrates why Lua is needed: FIFO lot tracking requires array manipulation, loops, and conditional removal — all impossible in pure SQL expressions or event rules.

## 11. Open Questions

### 11.1 Cross-table materialized views

**Problem:** Some analytics require joining data from multiple source tables. For example, computing `volume_usd` from `swaps` joined with `token_prices`.

**Challenge:** Joins in a streaming context require buffering and coordination. When a new swap arrives, we need the corresponding price — which may arrive in the same batch, a different batch, or not exist yet.

**Options:**
- (a) **PoC: single-source MVs only.** Cross-table computation done upstream in host SDK transformers.
- (b) **GA: lookup joins.** An MV can reference the latest value from another table (like ClickHouse's `dictGet`). Covers "enrich with latest price" without full join semantics.
- (c) **Future: temporal joins.** Full streaming join with time-based matching.

**Recommendation:** Option (a) for PoC, option (b) for GA.

### 11.2 Unrealized PnL (mark-to-market)

The reducer above computes **realized PnL** (profit/loss on closed trades). **Unrealized PnL** requires:

```
unrealized_pnl = position_size * (current_market_price - avg_cost)
```

This needs a `current_market_price` that changes continuously — not just when the user trades. Options:
- (a) Compute at query time in the downstream database: `positions.position_size * (latest_price - positions.avg_cost)`. The `positions` table already has `position_size` and `avg_cost`.
- (b) Use a cross-table lookup join (see 11.1) that joins positions with a price feed.
- (c) Accept a separate price stream and compute in a second reducer.

**Recommendation:** Option (a) for PoC. Option (b) when lookup joins land in GA.

### 11.3 Multi-chain

One Delta DB instance per chain. Multi-chain coordination (e.g., cross-chain aggregation) is handled at a higher level by running multiple pipelines and merging in the downstream target.

## 12. Performance Considerations

### 12.1 Why Rust?

- **Memory efficiency:** Per-group reducer state for high-cardinality keys (millions of user/token pairs) requires predictable memory without GC pauses.
- **Storage integration:** Direct access to RocksDB without FFI overhead for the hot path (state reads/writes, snapshot management).
- **Language-agnostic core:** A Rust engine can expose bindings to any host language (Node.js, Python, Go) without reimplementation.
- **Throughput:** Block processing at chain tip is latency-sensitive.

### 12.2 Benchmark targets (PoC)

| Metric | Target |
|--------|--------|
| Raw row ingestion | >100K rows/sec |
| Reducer (Event Rules) | >200K rows/sec |
| Reducer (Lua) | >100K rows/sec |
| MV update (single group key) | <1ms per batch |
| Rollback (75 blocks, 10K rows, snapshot) | <10ms |
| Rollback (75 blocks, 10K rows, replay) | <500ms |
| Memory usage (100K active group keys) | <500MB |

### 12.3 Batch merging optimization

When downstream is slow, Delta DB merges pending batches:
- Raw tables: accumulate rows (append-only)
- Reducers: process rows eagerly, keep latest state
- MVs: merge aggregation deltas (e.g., two pending `sum += 5` and `sum += 3` become `sum += 8`)
- Result: N batches collapse into 1 merged downstream flush

## 13. Implementation Plan

### Phase 1: PoC

**Scope:**
- Rust core engine with napi-rs bindings (TypeScript host SDK)
- SQL DDL parser for schema (tables, MVs, reducers)
- Reducer runtimes: Event Rules (Option B) + Lua (Option C)
- Storage: RocksDB-based, snapshot rollback strategy
- Aggregations: `sum`, `count`, `min`, `max`, `avg`, `first`, `last`
- Time windowing: `toStartOfInterval`
- Delta output: `insert` / `update` / `delete` records
- Single downstream target adapter (ClickHouse)
- Backpressure with batch merging

**Out of scope for PoC:**
- WASM reducer runtime
- SQL Expression reducers (Option A)
- Cross-table MVs / lookup joins
- Postgres / Kafka adapters
- Python / Go host SDKs

### Phase 2: GA

- WASM reducer runtime (Option D)
- SQL Expression reducers (Option A) as syntactic sugar
- Cross-table lookup joins
- `median`, `quantile`, `count_distinct` aggregations
- Postgres and Kafka target adapters
- Replay rollback strategy option
- Python host SDK (PyO3)
- Admin/debug HTTP endpoint
- Prometheus metrics

### Phase 3: Future

- Distributed Delta DB (sharded by group key)
- Temporal joins
- Snapshot export/import for bootstrapping
- Cross-chain aggregation
- Go host SDK

## Appendix A: Comparison with Alternatives

| Feature | Delta DB | Materialize | ClickHouse MVs | Flink | Pipes SDK Aggregator |
|---------|----------|-------------|----------------|-------|---------------------|
| Rollback-aware | Yes | No | Partial | No | Yes |
| Stateful reducers | Yes | No (SQL only) | No | Yes (Java) | No |
| Incremental MVs | Yes | Yes | Yes | Yes | Yes |
| Blockchain-native | Yes | No | No | No | Yes |
| Embedded (no infra) | Yes | No | No | No | Yes |
| `first`/`last` rollback | Yes | Yes | No | N/A | Yes |
| Scalable state | Yes (Rust+RocksDB) | Yes | Yes | Yes (RocksDB) | No (SQLite) |
| Delta output | Yes | Yes (CDC) | No | Yes | No |
| Language-agnostic | Yes (SQL+Lua+WASM) | SQL only | SQL only | Java/Scala | TypeScript only |
| Open source | Yes | No (fully) | Yes | Yes | Yes |

## Appendix B: Glossary

- **Block cursor:** `{ number, hash, timestamp }` — identifies a specific block on a specific fork.
- **Finalized block:** A block confirmed by chain consensus that cannot be reverted.
- **Unfinalized block:** A block between the finalized height and chain tip, subject to reorgs.
- **Rollback chain:** Ordered list of unfinalized block cursors maintained for fork recovery.
- **Fork / Reorg:** When the chain switches to a different branch, invalidating previously indexed blocks.
- **Delta record:** A minimal change record (`insert` / `update` / `delete`) emitted to downstream targets.
- **Raw table:** Direct storage of incoming blockchain data rows.
- **Reducer:** A stateful fold operation that enriches rows using accumulated per-group state. Processes rows sequentially, maintains mutable state, emits enriched rows.
- **Aggregate MV:** A derived table whose contents are incrementally maintained via GROUP BY aggregation.
- **Time window:** A fixed-interval time bucket (e.g., 5 minutes) used for temporal aggregation.
- **Backpressure:** Flow control mechanism that slows the producer when the consumer can't keep up.
- **Snapshot strategy:** Rollback approach where state is checkpointed per block for instant restore.
- **Replay strategy:** Rollback approach where state is rebuilt by re-processing raw rows from the last finalized checkpoint.
- **Event Rules:** Reducer syntax using `WHEN`/`THEN` pattern matching blocks for branch-per-event-type logic.

## Appendix C: Reducer Syntax Options — Detailed Comparison

This appendix provides a self-contained reference for evaluating the five reducer syntax options. All examples implement the **same PnL use case** for direct comparison.

**Use case:** Track per-user, per-token position and compute realized PnL on each trade.

**State:**
- `quantity` — current position size
- `cost_basis` — total cost of current position
- Derived: `avg_cost = cost_basis / quantity`

**Logic:**
- On **buy**: increase quantity and cost_basis
- On **sell**: compute `trade_pnl = amount * (price - avg_cost)`, decrease quantity and cost_basis
- Always emit: `trade_pnl`, `position_size`, `avg_cost`

---

### Option A: SQL Expressions with CASE

**Philosophy:** Purely declarative. No control flow — all branching via `CASE`/`IF`. State transitions declared as assignments in a `SET` block.

```sql
CREATE REDUCER pnl_tracker
  SOURCE trades
  GROUP BY user, token
  STATE (
    quantity   Float64 DEFAULT 0,
    cost_basis Float64 DEFAULT 0
  )
  LET
    avg_cost = IF(state.quantity > 0, state.cost_basis / state.quantity, 0),
    is_sell  = row.side = 'sell'
  SET
    state.quantity = state.quantity + CASE
      WHEN is_sell THEN -row.amount
      ELSE row.amount
    END,
    state.cost_basis = CASE
      WHEN is_sell THEN state.cost_basis - row.amount * avg_cost
      ELSE state.cost_basis + row.amount * row.price
    END
  EMIT
    CASE WHEN is_sell THEN row.amount * (row.price - avg_cost) ELSE 0 END AS trade_pnl,
    state.quantity AS position_size,
    avg_cost;
```

**Structure:**
```
CREATE REDUCER name
  SOURCE table
  GROUP BY cols
  STATE (col Type DEFAULT val, ...)
  LET local_var = expr, ...          -- computed once, available in SET/EMIT
  SET state.col = expr, ...          -- state mutations (all evaluated against pre-SET state)
  EMIT expr AS name, ...             -- output columns (evaluated against post-SET state)
```

**Evaluation semantics:**
- `LET` expressions are computed first (using current `state` and `row`)
- `SET` expressions are computed from pre-mutation state (all assignments happen "simultaneously")
- `EMIT` expressions see post-`SET` state

**Complexity to implement:**
- Parser: expression parser + `CASE`/`IF` support (straightforward, well-known grammar)
- Compiler: can compile expressions directly to Rust closures or bytecode
- No control flow graph needed

**Pros:**
- Purely declarative — each expression is independently analyzable
- Can be statically type-checked at schema load time
- Can be compiled to efficient native code (no interpreter needed)
- Familiar SQL expression syntax — no new concepts

**Cons:**
- Complex branching creates deeply nested `CASE` expressions
- When buy/sell logic diverges significantly, the `CASE` patterns repeat across `SET` and `EMIT`
- Not natural for > 2 branches (e.g., buy/sell/liquidation/fee)
- No iteration — can't express FIFO lot tracking

**Best for:** Simple reducers with 1-2 branches. Running balances, simple position tracking, cumulative counters.

**Verdict:** Good as syntactic sugar for simple cases in GA. Not sufficient as the only option.

---

### Option B: Event Rules (WHEN/THEN pattern matching)

**Philosophy:** Each "event type" (buy, sell, mint, burn) gets its own self-contained block with local variables, state updates, and emissions.

```sql
CREATE REDUCER pnl_tracker
  SOURCE trades
  GROUP BY user, token
  STATE (
    quantity   Float64 DEFAULT 0,
    cost_basis Float64 DEFAULT 0
  )

  WHEN row.side = 'buy' THEN
    SET state.quantity   = state.quantity + row.amount,
        state.cost_basis = state.cost_basis + row.amount * row.price
    EMIT trade_pnl = 0

  WHEN row.side = 'sell' THEN
    LET avg_cost = state.cost_basis / state.quantity
    SET state.quantity   = state.quantity - row.amount,
        state.cost_basis = state.cost_basis - row.amount * avg_cost
    EMIT trade_pnl = row.amount * (row.price - avg_cost)

  ALWAYS EMIT
    state.quantity AS position_size,
    IF(state.quantity > 0, state.cost_basis / state.quantity, 0) AS avg_cost;
```

**Structure:**
```
CREATE REDUCER name
  SOURCE table
  GROUP BY cols
  STATE (col Type DEFAULT val, ...)

  WHEN condition THEN               -- first matching block executes
    LET local = expr, ...           -- block-scoped locals
    SET state.col = expr, ...       -- state mutations
    EMIT col = expr, ...            -- block-specific output columns

  WHEN condition THEN ...           -- next pattern (evaluated only if prior didn't match)

  ALWAYS EMIT col = expr, ...;     -- output columns emitted for every row regardless of WHEN match
```

**Evaluation semantics:**
- `WHEN` blocks are evaluated top-to-bottom, **first match wins** (like SQL `CASE`)
- Within a block: `LET` -> `SET` -> `EMIT` (same as Option A)
- If no `WHEN` matches: row still triggers `ALWAYS EMIT` (with unchanged state)
- `ALWAYS EMIT` sees post-`SET` state (after the matched `WHEN` block executes)

**Complexity to implement:**
- Parser: `WHEN`/`THEN`/`SET`/`EMIT` blocks + expression parser (moderate)
- Compiler: condition evaluation + branch dispatch + expression evaluation
- Needs clear semantics for overlapping conditions and fallthrough behavior

**Pros:**
- Very readable — each event type is visually separated
- Natural fit for blockchain data (transactions have clear types: swap, transfer, mint, burn, etc.)
- Adding a new event type = adding a new `WHEN` block (no touching existing code)
- Flat structure even with many branches (no nesting)
- Statically analyzable — each block has known inputs/outputs

**Cons:**
- Novel syntax — no existing SQL standard to reference
- Semantics need careful definition (first-match vs all-match, pre/post-SET visibility)
- Still limited to expression-level logic within each block (no loops, no complex data structures)
- Can't express FIFO lot tracking or other algorithms requiring iteration

**Best for:** The majority of blockchain reducer use cases. Buy/sell, mint/burn, deposit/withdraw, stake/unstake patterns are everywhere.

**Verdict:** Recommended as the primary PoC syntax. Covers 80%+ of real blockchain use cases.

---

### Option C: Embedded Lua

**Philosophy:** Use a real, proven, embeddable scripting language. Full imperative expressiveness without inventing a language.

```sql
CREATE REDUCER pnl_tracker
  SOURCE trades
  GROUP BY user, token
  STATE (
    quantity   Float64 DEFAULT 0,
    cost_basis Float64 DEFAULT 0
  )
  LANGUAGE lua
  PROCESS $$
    local avg_cost = state.quantity > 0 and state.cost_basis / state.quantity or 0

    if row.side == 'buy' then
      state.quantity = state.quantity + row.amount
      state.cost_basis = state.cost_basis + row.amount * row.price
      emit.trade_pnl = 0
    else
      emit.trade_pnl = row.amount * (row.price - avg_cost)
      state.quantity = state.quantity - row.amount
      state.cost_basis = state.cost_basis - row.amount * avg_cost
    end

    emit.position_size = state.quantity
    emit.avg_cost = avg_cost
  $$;
```

**Execution model:**
```
For each row in batch:
  1. Rust engine loads state for group key into Lua table `state`
  2. Rust engine loads row data into Lua table `row`
  3. Lua VM executes PROCESS function
  4. Rust engine reads back `state` (mutations) and `emit` (output columns)
  5. Rust engine persists state snapshot
```

**Available in Lua sandbox:**
- `state` — mutable table, maps to reducer STATE columns
- `row` — read-only table, maps to source table columns
- `emit` — write-only table, output columns
- `json.encode()` / `json.decode()` — for complex state (arrays, nested objects)
- `math.*` — standard math library
- No I/O, no OS access, no `require`

**Complexity to implement:**
- Parser: trivial — just extract the `$$` block and hand it to the Lua VM
- Runtime: `mlua` crate in Rust (~200 lines of binding code)
- State serialization: map STATE columns to/from Lua tables
- Sandboxing: disable `io`, `os`, `debug`, `loadfile` modules

**Pros:**
- **Zero language design cost** — Lua already exists, is well-specified, well-documented
- Fully expressive: loops, functions, arrays, tables, closures
- Fast: LuaJIT-class performance for numerical work
- Battle-tested embedding model: Redis (EVAL), Nginx (OpenResty), game engines
- Sandboxed by default — no I/O unless explicitly enabled
- Tiny footprint (~200KB for Lua VM)

**Cons:**
- Another language in the stack — developers need to learn Lua basics
- Lua is niche (though simple enough to learn in an hour)
- No static type checking — type errors caught at runtime
- Debugging: no breakpoints, limited stack traces (can be mitigated with good error messages)
- Slightly slower than compiled Event Rules for simple cases (~100K vs ~200K rows/sec)

**Best for:** Complex algorithms that need loops, arrays, or conditional data structure manipulation. FIFO/LIFO lot tracking, fee tier calculation, complex rebasing logic.

**Verdict:** Recommended as the PoC escape hatch alongside Event Rules. Gives full expressiveness without building a custom language.

**Advanced Lua example — FIFO lot tracking:**

```sql
CREATE REDUCER fifo_pnl
  SOURCE trades
  GROUP BY user, token
  STATE (
    lots     String DEFAULT '[]',
    realized Float64 DEFAULT 0
  )
  LANGUAGE lua
  PROCESS $$
    local lots = json.decode(state.lots)

    if row.side == 'buy' then
      table.insert(lots, { qty = row.amount, price = row.price })
      emit.trade_pnl = 0
    else
      local remaining = row.amount
      local pnl = 0
      while remaining > 0 and #lots > 0 do
        local lot = lots[1]
        local used = math.min(remaining, lot.qty)
        pnl = pnl + used * (row.price - lot.price)
        lot.qty = lot.qty - used
        remaining = remaining - used
        if lot.qty <= 0 then table.remove(lots, 1) end
      end
      state.realized = state.realized + pnl
      emit.trade_pnl = pnl
    end

    state.lots = json.encode(lots)

    -- Compute position summary
    local total_qty, total_cost = 0, 0
    for _, lot in ipairs(lots) do
      total_qty = total_qty + lot.qty
      total_cost = total_cost + lot.qty * lot.price
    end
    emit.position_size = total_qty
    emit.avg_cost = total_qty > 0 and total_cost / total_qty or 0
  $$;
```

This is impossible in Options A, B, and E — it requires a loop over a dynamic-length array with conditional removal.

---

### Option D: WASM Process Functions

**Philosophy:** Maximum performance and language freedom. Users write reducers in any language that compiles to WebAssembly (Rust, Go, AssemblyScript, C, etc.), and Delta DB executes the compiled module.

**Schema definition (SQL side):**

```sql
CREATE REDUCER pnl_tracker
  SOURCE trades
  GROUP BY user, token
  STATE (
    quantity   Float64 DEFAULT 0,
    cost_basis Float64 DEFAULT 0
  )
  LANGUAGE wasm
  MODULE 'reducers/pnl_tracker.wasm'
  PROCESS 'process_trade';
```

**WASM module (Rust source, compiled to .wasm):**

```rust
use delta_db_sdk::*;

#[derive(State)]
struct PnlState {
    quantity: f64,
    cost_basis: f64,
}

#[derive(Emit)]
struct PnlEmit {
    trade_pnl: f64,
    position_size: f64,
    avg_cost: f64,
}

#[export_process]
fn process_trade(state: &mut PnlState, row: &Row) -> PnlEmit {
    let avg_cost = if state.quantity > 0.0 {
        state.cost_basis / state.quantity
    } else {
        0.0
    };

    let trade_pnl = if row.get_str("side") == "sell" {
        let pnl = row.get_f64("amount") * (row.get_f64("price") - avg_cost);
        state.quantity -= row.get_f64("amount");
        state.cost_basis -= row.get_f64("amount") * avg_cost;
        pnl
    } else {
        state.quantity += row.get_f64("amount");
        state.cost_basis += row.get_f64("amount") * row.get_f64("price");
        0.0
    };

    PnlEmit {
        trade_pnl,
        position_size: state.quantity,
        avg_cost,
    }
}
```

**WASM module (AssemblyScript source, for TypeScript-familiar developers):**

```typescript
// pnl_tracker.ts — compiled to .wasm via asc
import { State, Row, Emit } from "@subsquid/delta-db-as";

export function process_trade(state: State, row: Row, emit: Emit): void {
  const avg_cost = state.getF64("quantity") > 0
    ? state.getF64("cost_basis") / state.getF64("quantity")
    : 0;

  if (row.getString("side") == "sell") {
    const amount = row.getF64("amount");
    emit.setF64("trade_pnl", amount * (row.getF64("price") - avg_cost));
    state.setF64("quantity", state.getF64("quantity") - amount);
    state.setF64("cost_basis", state.getF64("cost_basis") - amount * avg_cost);
  } else {
    const amount = row.getF64("amount");
    emit.setF64("trade_pnl", 0);
    state.setF64("quantity", state.getF64("quantity") + amount);
    state.setF64("cost_basis", state.getF64("cost_basis") + amount * row.getF64("price"));
  }

  emit.setF64("position_size", state.getF64("quantity"));
  emit.setF64("avg_cost", avg_cost);
}
```

**Execution model:**
```
At schema load:
  1. Load .wasm module via wasmtime/wasmer
  2. Validate exported function signature matches STATE/EMIT schema
  3. Pre-allocate shared memory for state/row/emit buffers

For each row:
  1. Serialize state + row into WASM linear memory
  2. Call exported process function
  3. Read back state mutations and emit values from WASM memory
  4. Persist state snapshot (Rust side)
```

**Complexity to implement:**
- Runtime: `wasmtime` crate — well-supported, production-grade
- ABI design: define memory layout for state/row/emit (flatbuffers or custom)
- SDK: provide `delta_db_sdk` crate for Rust, `@subsquid/delta-db-as` for AssemblyScript
- Build tooling: users need to compile to `.wasm` before deploying schema

**Pros:**
- **Near-native performance** — ~95% of native Rust speed
- Write in any language: Rust, Go, C/C++, AssemblyScript, Zig, etc.
- Fully sandboxed — WASM has no host access by default
- Deterministic execution — great for auditability
- Future-proof — WASM ecosystem growing rapidly

**Cons:**
- **High barrier to entry**: requires compile step, separate toolchain
- Schema is split across `.sql` and `.wasm` — harder to review as a unit
- Debugging WASM is significantly harder than Lua or Event Rules
- State serialization across WASM boundary adds complexity and overhead
- AssemblyScript eases the learning curve but is a separate language from TypeScript
- Overkill for simple reducers

**Best for:** Production-grade reducers where performance is critical. Teams with Rust/Go expertise. Deployed reducers that rarely change.

**Verdict:** GA feature. Not needed for PoC — Lua covers the "full expressiveness" niche at lower cost.

---

### Option E: Imperative DSL (PL/pgSQL-style)

**Philosophy:** Build a custom procedural mini-language, embedded in SQL via `$$` delimiters. Similar to PL/pgSQL, ClickHouse UDFs, or dbt's Jinja SQL.

```sql
CREATE REDUCER pnl_tracker
  SOURCE trades
  GROUP BY user, token
  STATE (
    quantity   Float64 DEFAULT 0,
    cost_basis Float64 DEFAULT 0
  )
  PROCESS $$
    DECLARE avg_cost Float64;
    avg_cost := IF(state.quantity > 0, state.cost_basis / state.quantity, 0);

    IF row.side = 'sell' THEN
      EMIT trade_pnl := row.amount * (row.price - avg_cost);
      state.quantity  := state.quantity - row.amount;
      state.cost_basis := state.cost_basis - row.amount * avg_cost;
    ELSE
      EMIT trade_pnl := 0;
      state.quantity  := state.quantity + row.amount;
      state.cost_basis := state.cost_basis + row.amount * row.price;
    END IF;

    EMIT position_size := state.quantity;
    EMIT avg_cost := avg_cost;
  $$;
```

**Complexity to implement:**
- Parser: full grammar — DECLARE, IF/THEN/ELSE/END IF, assignments, expressions, potentially LOOP/WHILE/FOR
- Type system: variable declarations, type inference, coercion rules
- Interpreter or compiler: walk AST, evaluate statements, manage scope
- Error handling: line numbers, meaningful error messages, type mismatch diagnostics
- Documentation: language reference, tutorials, examples
- Testing: the language itself needs a test suite

**This is effectively building a programming language from scratch.**

**Pros:**
- Self-contained in SQL file — no external dependencies
- Familiar to PL/pgSQL users (Postgres stored procedures)
- Can be compiled to WASM or native for performance
- Full control over the language design (can add blockchain-specific features)

**Cons:**
- **Enormous implementation cost** — parser, type checker, interpreter/compiler, error messages, docs
- Custom language = custom bugs, custom edge cases, custom learning curve
- Inevitable scope creep: users will want loops → arrays → functions → imports
- Debugging: custom debugger, custom stack traces
- Competes with Lua (which does the same thing but already exists)
- Maintenance burden: every language feature is a permanent commitment

**Best for:** Products that want a fully branded, self-contained experience with no external language dependency.

**Verdict:** Not recommended. The implementation cost is extremely high, and Lua (Option C) provides the same expressiveness with zero language-design risk. If we invest in a custom language, we're competing with decades of language design for no clear benefit over embedding Lua or supporting WASM.

---

### Summary: decision matrix

| Criterion | A: SQL Expr | B: Event Rules | C: Lua | D: WASM | E: Imp. DSL |
|-----------|:-----------:|:--------------:|:------:|:-------:|:-----------:|
| **Implementation effort** | Low | Medium | Low | Medium | **Very High** |
| **Simple use cases** (balance tracking) | Excellent | Good | Good | Overkill | Good |
| **Medium use cases** (avg cost PnL) | OK | Excellent | Excellent | Good | Good |
| **Complex use cases** (FIFO PnL) | Impossible | Impossible | Excellent | Excellent | Possible |
| **Readability** | Medium | High | High | Low (external) | Medium |
| **Performance** | High | High | High | Highest | Medium |
| **Static type safety** | Full | Full | None | Partial | Partial |
| **Self-contained in SQL** | Yes | Yes | Yes | No | Yes |
| **Language risk** | None | Low (novel syntax) | None (exists) | None (exists) | **High** |
| **Learning curve for users** | Very low | Low | Medium | High | Medium |
| **Ecosystem maturity** | N/A | N/A | 30+ years | Growing | N/A |

### Recommended implementation order

```
Phase    Syntax              Rationale
------   ------------------  -----------------------------------------------
PoC      B: Event Rules      Covers 80%+ of blockchain use cases. Natural
                             pattern-matching syntax for buy/sell/mint/burn.
                             Moderate parser complexity. Statically analyzable.

PoC      C: Lua              Escape hatch for complex logic. Zero language
                             design cost (use mlua). Covers FIFO, complex
                             fee structures, anything Event Rules can't do.

GA       D: WASM             Production performance. Language-agnostic.
                             Teams deploy compiled reducers for maximum
                             throughput and auditability.

GA       A: SQL Expressions  Syntactic sugar for trivial reducers. Users
                             who only need a running balance shouldn't have
                             to learn WHEN/THEN blocks.

Defer    E: Imperative DSL   Not recommended. Lua and WASM cover the same
                             ground without the cost of designing, building,
                             and maintaining a custom language.
```
