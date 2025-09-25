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

await Promise.all([
  $`tsup src/version.ts --no-config --dts --format esm --outDir dist`.stdio('pipe', 'pipe', 'pipe'),
  $`tsup src/version.ts --no-config --dts --format cjs --outDir dist`.stdio('pipe', 'pipe', 'pipe'),
])

await $`scripts/fix-imports.ts`

await fs.copy('./README.md', 'dist/README.md')
// await updateAndCopyPackageJson()
// await fs.remove('dist')
// await fs.rename('dist.new', 'dist')
