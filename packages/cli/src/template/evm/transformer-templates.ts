import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { EvmTemplateIds } from "~/config/templates.js";
import {
  parseImports,
  generateImportStatement,
} from "~/utils/merge-imports.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function readTemplateFile(relativePath: string): string {
  return readFileSync(join(__dirname, relativePath), "utf-8");
}

function parseTemplateFile(relativePath: string): {
  imports: string[];
  code: string;
} {
  const content = readTemplateFile(relativePath);
  const { imports, code } = parseImports(content);
  return {
    imports: imports
      .map(generateImportStatement)
      .filter((stmt) => stmt.length > 0),
    code,
  };
}

export const evmTemplates: Record<
  EvmTemplateIds,
  {
    compositeKey: string;
    transformer: string;
    imports?: string[];
    tableName: string;
    clickhouseTableTemplate?: string;
    drizzleTableName?: string;
    drizzleSchema?: string;
  }
> = {
  minimal: {
    compositeKey: "custom",
    transformer: `evmDecoder({
      range: { from: "latest" },
      contracts: [],
      events: {},
    })`,
    tableName: "minimal",
  },
  "erc20-transfers": (() => {
    const parsed = parseTemplateFile("erc20-transfers/transformer.ts");
    return {
      compositeKey: "transfers",
      tableName: "erc20_transfers",
      drizzleTableName: "transfersTable",
      transformer: parsed.code,
      imports: parsed.imports,
      clickhouseTableTemplate: readTemplateFile(
        "erc20-transfers/clickhouse-table.sql"
      ),
      drizzleSchema: readTemplateFile("erc20-transfers/pg-table.ts"),
    };
  })(),
  "uniswap-v3-swaps": (() => {
    const parsed = parseTemplateFile("uniswap-v3-swaps/transformer.ts");
    return {
      compositeKey: "swaps",
      tableName: "uniswap_v3_swaps",
      drizzleTableName: "uniswapV3Swaps",
      transformer: parsed.code,
      imports: parsed.imports,
      clickhouseTableTemplate: readTemplateFile("uniswap-v3-swaps/clickhouse-table.sql"),
      drizzleSchema: readTemplateFile("uniswap-v3-swaps/pg-table.ts"),
    };
  })(),
};
