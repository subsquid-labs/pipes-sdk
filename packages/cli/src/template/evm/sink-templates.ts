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
    onData: async ({ data, store }) => {
{{#templates}}
{{#hasTable}}
{{^excludeFromInsert}}
      await store.insert({
        table: '{{{tableName}}}',
        values: toSnakeKeysArray(data.{{{compositeKey}}}),
        format: 'JSONEachRow',
      });
{{/excludeFromInsert}}
{{/hasTable}}
{{/templates}}
{{#hasCustomContracts}}
      /**
       * Once the data is transformed, you can insert it into the database.
       * 
       * await store.insert({
       *   table: 'custom_contract',
       *   values: toSnakeKeysArray(data.custom),
       *   format: 'JSONEachRow',
       * })
       */
{{/hasCustomContracts}}
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
{{^excludeFromInsert}}
      for (const values of chunk(data.{{{compositeKey}}})) {
        await tx.insert({{{drizzleTableName}}}).values(values)
      }
{{/excludeFromInsert}}
{{/hasTable}}
{{/templates}}
{{#hasCustomContracts}}
      /**
       * Once the data is transformed, you can insert it into the database.
       *  
       * for (const values of chunk(data.custom)) {
       *   await tx.insert(customContract).values(values)
       * }
       */
{{/hasCustomContracts}}
    },
  })`;
