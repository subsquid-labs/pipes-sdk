import { defineConfig } from 'tsup'

export default defineConfig([
  // Main CLI entry - CJS only (for binary)
  {
    entry: ['src/index.ts'],
    outDir: 'dist',
    format: ['cjs'],
    clean: true,
    bundle: true,
    splitting: false,
    sourcemap: true,
    tsconfig: 'tsconfig.json',
    // `ora@9` is pure ESM. Node 22+'s native `require(esm)` returns a namespace
    // that has `__esModule: true`, which interacts badly with tsup's `__toESM(..., 1)`
    // shim: the shim overwrites `.default` with the whole namespace object, so
    // `(0, import_ora.default)(...)` throws "is not a function" at runtime.
    // Inline ora (and its pure-ESM transitive deps) into the CJS bundle to bypass
    // the broken shim path.
    noExternal: ['ora'],
    banner: {
      js: '#!/usr/bin/env node\n',
    },
  },
  // Config files - both ESM and CJS (for UI and CLI)
  {
    entry: {
      'config/networks': 'src/commands/init/config/networks.ts',
      'config/templates': 'src/commands/init/config/templates.ts',
      'config/targets': 'src/commands/init/config/targets.ts',
      'services/sqd-abi': 'src/services/sqd-abi.ts',
    },
    outDir: 'dist',
    format: ['esm', 'cjs'],
    clean: false,
    bundle: true,
    splitting: false,
    sourcemap: true,
    tsconfig: 'tsconfig.json',
    dts: true,
  },
])
