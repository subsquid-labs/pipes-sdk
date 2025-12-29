import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  outDir: "dist",
  format: ["cjs"],
  bundle: true,
  splitting: false,
  sourcemap: true,
  tsconfig: "tsconfig.json",
});
