import type { Sink } from "~/types/sink.js";

export const baseDependencies = ["@subsquid/pipes"];

export const baseDevDependencies = [
  "typescript",
  "@biomejs/biome",
  "tsx",
  "tsup",
  "@types/node",
];

export const sinkDependencies: Record<Sink, string[]> = {
  clickhouse: ["@clickhouse/client"],
  postgresql: ["drizzle-kit", "drizzle-orm", "pg", "dotenv"],
  memory: [],
};

export function getDependencies(sink: Sink): {
  dependencies: string[];
  devDependencies: string[];
} {
  return {
    dependencies: [...baseDependencies, ...sinkDependencies[sink]],
    devDependencies: baseDevDependencies,
  };
}
