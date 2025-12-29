import Mustache from "mustache";
import { Config } from "~/types/config.js";
import { NetworkType } from "~/types/network.js";

export const schemasTemplate = `import {
  integer,
  numeric,
  pgTable,
  primaryKey,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core'

{{#schemas}}
{{{schema}}}

{{/schemas}}
export default {
{{#schemas}}
  {{{tableName}}},
{{/schemas}}
}
`;

export function renderSchemasTemplate(config: Config<NetworkType>): string {
  const schemas = Object.entries(config.templates)
    .filter(([, value]) => value.drizzleSchema)
    .map(([, value]) => ({
      schema: value.drizzleSchema,
      tableName: value.drizzleTableName,
    }));

  return Mustache.render(schemasTemplate, { schemas });
}
