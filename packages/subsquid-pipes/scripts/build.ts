#!/usr/bin/env -S pnpm tsx
import 'zx/globals'
import cpy from 'cpy'

await fs.remove('dist')

await Promise.all([
  (async () => {
    await $`tsup`.stdio('pipe', 'pipe', 'pipe')
  })(),
  (async () => {
    await $`tsc -p tsconfig.dts.json`.stdio('pipe', 'pipe', 'pipe')
    await cpy('dist-dts/**/*.d.ts', 'dist', {
      rename: (basename) => basename.replace(/\.d\.ts$/, '.d.ts'),
    })
  })(),
])

await $`scripts/fix-imports.ts`
