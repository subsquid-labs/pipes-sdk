import Mustache from "mustache";
import { Config } from "~/types/config.js";
import {
  clickhouseSinkTemplate,
  postgresSinkTemplate,
} from "./sink-templates.js";
import { Sink } from "~/types/sink.js";
import { NetworkType } from "~/types/network.js";

export const template = (
  sink: Sink
) => `import { evmDecoder, evmPortalSource, commonAbis } from "@subsquid/pipes/evm";
${
  sink === "clickhouse"
    ? `
import { clickhouseTarget } from "@subsquid/pipes/targets/clickhouse";
import { createClient } from "@clickhouse/client";
`
    : `
import { chunk, drizzleTarget } from "@subsquid/pipes/targets/drizzle/node-postgres";
import { drizzle } from "drizzle-orm/node-postgres";
{{#schemaImports}}
import { {{{drizzleTableName}}} } from "./schemas.js";
{{/schemaImports}}
`
}

export async function main() {
  await evmPortalSource({
    portal: "https://portal.sqd.dev/datasets/{{network}}",
  })
  .pipeComposite({
{{#templates}}
    {{{compositeKey}}}: {{{transformer}}},
{{/templates}}
  })
  .pipeTo(${
    sink === "clickhouse" ? clickhouseSinkTemplate : postgresSinkTemplate
  });
}
`;

export function renderStarterTemplate(config: Config<NetworkType>): string {
  const templateEntries = Object.entries(config.templates);
  const values = {
    network: config.network,
    templates: templateEntries.map(([, value], index) => {
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
    schemaImports:
      config.sink === "postgresql"
        ? templateEntries
            .filter(([, value]) => value.drizzleTableName)
            .map(([, value]) => ({ drizzleTableName: value.drizzleTableName }))
        : [],
    contractAddresses: config.contractAddresses,
  };

  return Mustache.render(template(config.sink), values);
}
