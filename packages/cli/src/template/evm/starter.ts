import Mustache from "mustache";
import { Config } from "~/types/config.js";
import {
  clickhouseSinkTemplate,
  postgresSinkTemplate,
} from "./sink-templates.js";
import { Sink } from "~/types/sink.js";
import { NetworkType } from "~/types/network.js";
import {
  parseImports,
  mergeImports,
  generateImportStatement,
} from "~/utils/merge-imports.js";

export const template = (sink: Sink) => `{{#mergedImports}}
{{{.}}}
{{/mergedImports}}

export async function main() {
  await evmPortalSource({
    portal: "https://portal.sqd.dev/datasets/{{network}}",
  })
  .pipeComposite({
{{#templates}}
    {{{compositeKey}}}: {{{transformer}}},
{{/templates}}
{{#customContracts}}
    {{{compositeKey}}}: evmDecoder({
      range: { from: "latest" },
      contracts: ["{{{address}}}"],
      /**
       * Or optionally use only a subset of events by passing the events object directly:
       * \`\`\`ts
       * events: {
       *   transfers: erc20.events.Transfer,
       * },
       * \`\`\`
       */
      events: {{{eventsAlias}}}, 
    }),
{{/customContracts}}
  })
  /**
   * Start transforming the data coming from the source.
   * \`\`\`ts
   * .pipe(({ contract1 }) => {
   *   return contract1.SomeEvent.map(e => {
   *     // do something
   *   })
   * })
   * \`\`\`
   */
  .pipeTo(${
    sink === "clickhouse" ? clickhouseSinkTemplate : postgresSinkTemplate
  });
}
`;

export function renderStarterTemplate(config: Config<NetworkType>): string {
  const templateEntries = Object.entries(config.templates);
  const isCustomContractFlow = config.contractAddresses.length > 0;

  // Build contract imports and custom contracts for custom contract flow
  const contractImports = isCustomContractFlow
    ? config.contractAddresses.map((address, index) => ({
        address,
        eventsAlias: `contract${index + 1}Events`,
      }))
    : [];

  const customContracts = isCustomContractFlow
    ? config.contractAddresses.map((address, index) => ({
        compositeKey: `contract${index + 1}`,
        address,
        eventsAlias: `contract${index + 1}Events`,
      }))
    : [];

  // Collect all imports from various sources
  const allImportStrings: string[] = [];

  // 1. Template imports
  if (!isCustomContractFlow) {
    for (const [, value] of templateEntries) {
      if (value.imports && value.imports.length > 0) {
        allImportStrings.push(...value.imports);
      }
    }
  }

  // 2. Base imports
  allImportStrings.push(
    "import { evmDecoder, evmPortalSource, commonAbis } from \"@subsquid/pipes/evm\";"
  );

  // 3. Sink-specific imports
  if (config.sink === "clickhouse") {
    allImportStrings.push(
      "import { clickhouseTarget } from \"@subsquid/pipes/targets/clickhouse\";",
      "import { createClient } from \"@clickhouse/client\";"
    );
  } else {
    allImportStrings.push(
      "import { chunk, drizzleTarget } from \"@subsquid/pipes/targets/drizzle/node-postgres\";",
      "import { drizzle } from \"drizzle-orm/node-postgres\";"
    );
  }

  // 4. Schema imports
  if (config.sink === "postgresql") {
    for (const [, value] of templateEntries) {
      if (value.drizzleTableName) {
        allImportStrings.push(
          `import { ${value.drizzleTableName} } from "./schemas.js";`
        );
      }
    }
  }

  // 5. Contract imports
  for (const contract of contractImports) {
    allImportStrings.push(
      `import { events as ${contract.eventsAlias} } from "./contracts/${contract.address}.js";`
    );
  }

  // Parse and merge all imports to avoid duplicates
  const combinedImports = allImportStrings.join("\n");
  const parsedImports = combinedImports
    ? parseImports(combinedImports).imports
    : [];
  const mergedImports = mergeImports(parsedImports);
  const mergedImportStatements = mergedImports
    .map(generateImportStatement)
    .filter((stmt: string) => stmt.length > 0);

  const values = {
    network: config.network,
    mergedImports: mergedImportStatements,
    // Only use templates when not in custom contract flow
    templates: isCustomContractFlow
      ? []
      : templateEntries.map(([, value], index) => {
          const table =
            config.sink === "clickhouse"
              ? value.clickhouseTableTemplate
              : value.drizzleSchema;
          return {
            compositeKey: value.compositeKey,
            transformer: value.transformer,
            tableName: value.tableName,
            drizzleTableName: value.drizzleTableName,
            table,
            hasTable: Boolean(table),
            last: index === templateEntries.length - 1,
          };
        }),
    customContracts,
  };

  return Mustache.render(template(config.sink), values);
}
