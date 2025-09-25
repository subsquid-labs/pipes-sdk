import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    watch: false,
    maxConcurrency: 2,
    fileParallelism: true,
    testTimeout: 20_000,
    teardownTimeout: 1_000,
    slowTestThreshold: 10_000,
    hideSkippedTests: false,
    expandSnapshotDiff: true,
    bail: 1,
    coverage: {
      enabled: false,
      provider: 'v8',
      reportsDirectory: './coverage',
      include: ['src'],
      exclude: ['src/tests'],
    },
    pool: 'forks',
    poolOptions: {
      forks: {
        isolate: false,
        singleFork: true,
      },
    },
  },
})
