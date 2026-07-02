import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    watch: false,
    testTimeout: 20_000,
    include: ['examples/**/*testing*.example.ts'],
  },
})
