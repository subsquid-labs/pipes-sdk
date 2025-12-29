import { EvmTemplateIds } from "~/config/templates.js";

export const erc20TransfersTransformer = `evmDecoder({
      profiler: { id: "erc20-transfers" }, // Optional: add a profiler to measure the performance of the transformer
      range: { from: "latest" },
      // Uncomment the line below to filter by contract addresses
      // contracts: ["0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"], // WETH on Ethereum mainnet
      events: {
        transfers: commonAbis.erc20.events.Transfer,
      },
    }).pipe(({ transfers }) => transfers.map((transfer) => ({
      blockNumber: transfer.block.number,
      from: transfer.event.from,
      to: transfer.event.to,
      value: transfer.event.value,
      tokenAddress: transfer.contract,
      timestamp: transfer.timestamp,
    })))`;

export const minimalTemplate = `evmDecoder({
      profiler: { id: "minimal" }, // Optional: add a profiler to measure the performance of the transformer
      range: { from: "latest" },
      contracts: [],
      events: {},
    })`;

export const evmTemplates: Record<
  EvmTemplateIds,
  {
    compositeKey: string;
    transformer: string;
    tableName: string;
    clickhouseTableTemplate?: string;
    drizzleTableName?: string;
    drizzleSchema?: string;
  }
> = {
  minimal: {
    compositeKey: "custom",
    transformer: minimalTemplate,
    tableName: "minimal",
  },
  "erc20-transfers": {
    compositeKey: "transfers",
    tableName: "erc20_transfers",
    transformer: erc20TransfersTransformer,
    clickhouseTableTemplate: `CREATE TABLE IF NOT EXISTS erc20_transfers (
        block_number UInt32,
        timestamp DateTime(3),
        from String,
        to String,
        value UInt256,
        token_address String,
        sign Int8
      )
      ENGINE = CollapsingMergeTree(sign)
      ORDER BY (block_number, timestamp, from, to, token_address)`,
    drizzleTableName: "transfersTable",
    drizzleSchema: `export const transfersTable = pgTable(
  "transfers",
  {
    blockNumber: integer().notNull(),
    timestamp: timestamp(),
    from: varchar().notNull(),
    to: varchar().notNull(),
    value: numeric({ mode: "bigint" }).notNull(),
    tokenAddress: varchar().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.blockNumber, table.from, table.to, table.tokenAddress] }),
  ]
);`,
  },
};
