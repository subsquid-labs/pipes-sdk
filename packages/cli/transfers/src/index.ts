import { evmDecoder, evmPortalSource, commonAbis } from "@subsquid/pipes/evm";

import {
  chunk,
  drizzleTarget,
} from "@subsquid/pipes/targets/drizzle/node-postgres";
import { drizzle } from "drizzle-orm/node-postgres";

export async function main() {
  await evmPortalSource({
    portal: "https://portal.sqd.dev/datasets/ethereum-mainnet",
  })
    .pipeComposite({
      custom: evmDecoder({
        range: { from: "latest" },
        contracts: [],
        events: {},
      }),
    })
    .pipeTo(
      drizzleTarget({
        db: drizzle(
          process.env.DB_CONNECTION_STR ??
            (() => {
              throw new Error("DB_CONNECTION_STR env missing");
            })()
        ),
        tables: [],
        onData: async ({ tx, data }) => {},
      })
    );
}
