import { hyperliquidFillsPortalSource, HyperliquidFillsQueryBuilder } from '@subsquid/pipes/hyperliquid-fills'

/**
 * Basic example demonstrating how to fetch hyperliquid fills for a specific user.
 */

async function cli() {
  const queryBuilder = new HyperliquidFillsQueryBuilder()
    .addFields({
      block: { number: true, timestamp: true },
      // To get more information about fills abbreviations please check the docs:
      // https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/notation
      fill: { user: true, px: true, sz: true, side: true, coin: true }
    })
    .addFill({
      request: {
        user: ['0x31ca8395cf837de08b24da3f660e77761dfb974b'],
      },
      range: {
        // Earlier blocks aren't supported yet
        from: 750_000_000
      }
    })
  const stream = hyperliquidFillsPortalSource({
    portal: 'https://portal.tethys.sqd.dev/datasets/hl-node-fills',
    query: queryBuilder,
  })

  for await (const { data } of stream) {
    for (const block of data.blocks) {
      for (const fill of block.fills) {
        console.log(fill)
      }
    }
  }
}

void cli()
