import path from 'node:path'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    watch: false,
    testTimeout: 20_000,
    include: ['examples/**/*testing*.example.ts', 'benchmarks/parquet-engines/bench-pipeline/**/*.test.ts'],
  },
  resolve: {
    alias: {
      // The parquet-engines benchmark harness imports @subsquid/pipes sources by relative
      // path; those sources resolve their own internals through the `~` alias.
      '~': path.resolve(__dirname, '../packages/pipes/src'),
    },
  },
})
