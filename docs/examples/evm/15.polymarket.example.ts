import { readFileSync } from 'fs'

import { createDefaultLogger, humanBytes } from '@subsquid/pipes'
import { evmDecoder, evmPortalSource } from '@subsquid/pipes/evm'
import { metricsServer } from '@subsquid/pipes/metrics/node'
import { deltaDbTarget } from '@subsquid/pipes/targets/delta-db'

import { exchangeEvents } from './abi/polymarket/abi'

/**
 * Polymarket order tracking with insider detection.
 *
 * Pipeline:
 *   Portal (Polygon) → evmDecoder → transform → Delta DB → onDelta
 *
 * 1. evmPortalSource streams raw blocks from Polygon via the Portal API,
 *    starting at block 35,873,440.
 * 2. evmDecoder filters for OrdersMatched events emitted by the Polymarket
 *    exchange contract (0x4bFb...982E) and decodes them using the ABI.
 * 3. transform maps each decoded event into an `orders` row — determining
 *    buy/sell side from takerAssetId and converting BigInt fields to strings.
 * 4. deltaDbTarget ingests rows into an embedded Delta DB that runs two
 *    SQL reducers defined in polymarket.sql:
 *      - market_stats: per-asset volume, trade count, and price moments
 *      - insider_classifier: flags traders who place >$4k in buys at <0.95
 *        within a 15-minute window, then tracks all their subsequent trades
 *    and two materialized views: token_summary, insider_positions.
 * 5. onDelta receives each flushed delta batch for downstream consumption.
 */

const SCHEMA = readFileSync(new URL('./schemas/polymarket.sql', import.meta.url), 'utf-8')

const logger = createDefaultLogger()

async function cli() {
  let totalOrders = 0
  const startTime = Date.now()

  await evmPortalSource({
    id: 'polymarket-insiders',
    logger,
    portal: {
      url: 'https://portal.sqd.dev/datasets/polygon-mainnet',
      minBytes: 40 * 1024 * 1024, // 80 MB
    },
    outputs: evmDecoder({
      range: { from: '35,873,440' },
      contracts: ['0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E'.toLowerCase()],
      events: {
        OrdersMatched: exchangeEvents.OrdersMatched,
      },
    }),

    metrics: metricsServer(),
  })
    .pipe({
      profiler: { name: 'transform' },
      transform: (data, ctx) => {
        totalOrders += data.OrdersMatched.length
        const elapsed = (Date.now() - startTime) / 1000
        ctx.logger.info({
          message: `input batch ${data.OrdersMatched.length}`,
          blocksCount: ctx.batch.blocksCount,
          batchSize: `${humanBytes(ctx.batch.bytesSize)}`,
        })

        ctx.logger.info(`Input orders/sec: ${(totalOrders / elapsed).toFixed(1)} (total: ${totalOrders})`)

        return {
          orders: data.OrdersMatched.map((order) => {
            const isBuy = order.event.takerAssetId === 0n

            return {
              block_number: order.block.number,
              timestamp: Math.floor(order.timestamp.valueOf() / 1000),
              trader: order.event.takerOrderMaker,
              asset_id: isBuy ? order.event.makerAssetId : order.event.takerAssetId,
              usdc: isBuy ? order.event.takerAmountFilled : order.event.makerAmountFilled,
              shares: isBuy ? order.event.makerAmountFilled : order.event.takerAmountFilled,
              side: isBuy ? 'buy' : 'sell',
            }
          }),
        }
      },
    })
    .pipeTo(
      deltaDbTarget({
        schema: SCHEMA,
        dataDir: './polymarket.delta-db',
        onDelta: ({ batch }) => {
          // We will save the batch to a downstream store, e.g. Postgres or Clickhouse,
          // after processing it with reducers and MVs in Delta DB

          logger.info(`Delta batch ${batch.sequence} processed`)
        },
      }),
    )
}

void cli()
