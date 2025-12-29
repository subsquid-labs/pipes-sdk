export const packageJsonTemplate = `{
  "name": "{{projectName}}",
  "version": "0.0.1",
  "type": "module",
  "private": true,
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "tsx src/index.ts",
    "build": "tsup src/index.ts --format esm --dts",
    "lint": "biome check . --write",
    "format": "biome format . --write"
  }
}`;
