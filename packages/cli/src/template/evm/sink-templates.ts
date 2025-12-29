export const clickhouseSinkTemplate = `clickhouseTarget({
    client: createClient({
      username: 'default',
      password: 'password',
      url: 'http://localhost:8123',
    }),
    onStart: async ({ store }) => {
{{#templates}}
{{#hasTable}}
      await store.command({
        query: \`{{{table}}}\`,
      });
{{/hasTable}}
{{/templates}}
    },
    onData: async ({ ctx, data, store }) => {
{{#templates}}
{{#hasTable}}
      await store.insert({
        table: '{{{tableName}}}',
        values: data.{{{compositeKey}}},
        format: 'JSONEachRow',
      });
{{/hasTable}}
{{/templates}}
    },
    onRollback: async ({ safeCursor, store }) => {
      await store.removeAllRows({
        tables: [
{{#templates}}
{{#hasTable}}
          '{{{tableName}}}',
{{/hasTable}}
{{/templates}}
        ],
        where: 'block_number > {latest:UInt32}',
        params: { latest: safeCursor.number },
      });
    },
  })`;

export const postgresSinkTemplate = `drizzleTarget({
    db: drizzle(
      process.env.DB_CONNECTION_STR ??
        (() => { throw new Error('DB_CONNECTION_STR env missing') })(),
    ),
    tables: [{{#templates}}{{{drizzleTableName}}}{{^last}}, {{/last}}{{/templates}}],
    onData: async ({ tx, data }) => {
{{#templates}}
{{#hasTable}}
      for (const values of chunk(data.{{{compositeKey}}})) {
        await tx.insert({{{drizzleTableName}}}).values(values)
      }
{{/hasTable}}
{{/templates}}
    },
  })`;
