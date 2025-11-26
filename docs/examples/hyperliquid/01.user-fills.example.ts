import { HyperliquidFillsQueryBuilder, hyperliquidFillsPortalSource } from '@subsquid/pipes/hyperliquid'

/**
 * Basic example demonstrating how to fetch hyperliquid fills for a specific user.
 */
async function cli() {
  const queryBuilder = new HyperliquidFillsQueryBuilder()
    .addFields({
      block: {
        number: true,
        timestamp: true,
      },
      // To get more information about fills abbreviations please check the docs:
      // https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/notation
      fill: {
        tid: true,
        fillIndex: true,
        user: true,
        px: true,
        sz: true,
        side: true,
        coin: true,
        time: true,
        closedPnl: true,
      },
    })
    .addFill({
      request: {},
      range: {
        // Earlier blocks aren't supported yet
        from: 750_000_000,
      },
    })
  const stream = hyperliquidFillsPortalSource({
    portal: process.env['PORTAL_URL'] || 'https://portal.sqd.dev/datasets/hl-node-fills',
    query: queryBuilder,
  })

  for await (const { data } of stream) {
    for (const block of data.blocks) {
      if (block.fills.length === 0) continue

      console.log(block.fills)
    }
  }
}

void cli()
