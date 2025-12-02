import { keccak256 } from '@subsquid/evm-abi'
import { evmDecoder, evmPortalSource, factory, factorySqliteDatabase } from '@subsquid/pipes/evm'
import { metricsServer } from '@subsquid/pipes/metrics/node'
import * as BatchSender from './abi/gmx/BatchSender'
import * as EventEmitter from './abi/gmx/EventEmitter'
import * as GlpManager from './abi/gmx/GlpManager'
import * as GlvToken from './abi/gmx/GlvToken'
import * as MarketToken from './abi/gmx/MarketToken'
import * as Vault from './abi/gmx/Vault'

const toBlock = '220,000,000'

function toKeccak256Hex(input: string): string {
  return `0x${keccak256(input).toString('hex')}`
}

async function cli() {
  const stream = evmPortalSource({
    portal: {
      url: 'https://portal.sqd.dev/datasets/arbitrum-one',
    },
    metrics: metricsServer({
      port: 9090,
    }),
  }).pipeComposite({
    Vault: evmDecoder({
      range: { from: '107,737,756', to: toBlock },
      events: { SellUSDG: Vault.events.SellUSDG },
    }),
    GlpManager: evmDecoder({
      range: { from: '107,737,756', to: toBlock },
      events: { RemoveLiquidity: GlpManager.events.RemoveLiquidity },
    }),
    BatchSender: evmDecoder({
      range: { from: '107,737,756', to: toBlock },
      events: { BatchSend: BatchSender.events.BatchSend },
    }),
    BatchSenderNew: evmDecoder({
      range: { from: '150,447,937', to: toBlock },
      events: { BatchSend: BatchSender.events.BatchSend },
    }),
    EventEmitter: evmDecoder({
      range: { from: '150,447,937', to: toBlock },
      events: {
        EventLog: EventEmitter.events.EventLog,
        EventLog1: EventEmitter.events.EventLog1,
        EventLog2: EventEmitter.events.EventLog2,
      },
    }),
    Tokens: evmDecoder({
      range: { from: '107,737,756', to: toBlock },
      contracts: factory({
        address: '0xC8ee91A54287DB53897056e12D9819156D3822Fb',
        event: EventEmitter.events.EventLog1,
        _experimental_preindex: { from: '107,737,756', to: toBlock },
        args: {
          topic1: ['MarketCreated', 'GlvCreated'].map(toKeccak256Hex),
        },
        parameter: (e) => {
          switch (e.eventName) {
            case 'MarketCreated': {
              const token = e.eventData.addressItems.items.find((item) => item.key === 'marketToken')
              if (!token) throw new Error('Unexpected token for market')

              return token.value
            }
            case 'GlvCreated': {
              const token = e.eventData.addressItems.items.find((item) => item.key === 'glvToken' || item.key === 'glv')
              if (!token) throw new Error('Unexpected token for market')

              return token.value
            }
            default:
              return null
          }
        },
        database: factorySqliteDatabase({
          path: './arb-tokens.sqlite',
          enableWAL: false,
        }),
      }),
      events: {
        allTransfers: MarketToken.events.Transfer,
        //  we removed GlvToken.events.Transfer because it has the same signature as MarketToken.events.Transfer, so
        //  both events would be decoded into transfers, and we only can split them by factory event name later
        //  marketTransfers: MarketToken.events.Transfer,
        //  glvTransfers: GlvToken.events.Transfer,
      },
    }).pipe(({ allTransfers }) => {
      return {
        glvTransfers: allTransfers.filter((item) => item.factory?.event.eventName === 'GlvCreated'),
        marketTransfers: allTransfers.filter((item) => item.factory?.event.eventName === 'MarketCreated'),
      }
    }),
  })

  for await (const { data, ctx } of stream) {
    // if (data.transfers.length > 0) {
    //   const tokens = new Set(data.transfers.map((t) => t.contract))
    //   ctx.logger.info(`parsed ${data.transfers.length} transfers from ${tokens.size} tokens`)
    // }
  }
}

void cli()
