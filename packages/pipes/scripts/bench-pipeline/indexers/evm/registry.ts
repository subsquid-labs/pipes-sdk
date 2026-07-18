import { type AbiEvent, indexed } from '@subsquid/evm-abi'
import type { Struct } from '@subsquid/evm-codec'
import * as p from '@subsquid/evm-codec'

import { sigEvent } from './shared.js'

export type NamedEvent = { signature: string; abi: AbiEvent<Struct> }

export type DecodedRegistryEvent = {
  signature: string
  eventHash: string
  namedArgs: Record<string, unknown>
  protocol: string | null
}

type AddressRegistration = {
  protocol: string
  events: Map<string, NamedEvent>
}

/**
 * Topic-keyed event decoder with address registrations taking precedence over
 * canonical any-address registrations.
 */
export class EventRegistry {
  readonly #bySignature = new Map<string, NamedEvent>()
  readonly #byAddress = new Map<string, AddressRegistration>()

  registerBySignature(events: NamedEvent[]): void {
    for (const event of events) {
      this.#bySignature.set(event.abi.topic, event)
    }
  }

  register(address: string, events: NamedEvent[], protocol: string): void {
    const key = address.toLowerCase()
    const existing = this.#byAddress.get(key)
    const entry = existing ?? { protocol, events: new Map<string, NamedEvent>() }
    for (const event of events) {
      entry.events.set(event.abi.topic, event)
    }
    if (!existing) {
      this.#byAddress.set(key, entry)
    }
  }

  lookupProtocol(address: string): string | undefined {
    return this.#byAddress.get(address.toLowerCase())?.protocol
  }

  decodeEvent(address: string, topics: string[], data: string): DecodedRegistryEvent | null {
    const topic0 = topics[0]
    if (!topic0) {
      return null
    }

    const addressEntry = this.#byAddress.get(address.toLowerCase())
    const match = addressEntry?.events.get(topic0) ?? this.#bySignature.get(topic0)
    if (!match) {
      return null
    }

    try {
      const namedArgs = match.abi.decode({ topics, data })

      return {
        signature: match.signature,
        eventHash: topic0,
        namedArgs,
        protocol: addressEntry?.protocol ?? null,
      }
    } catch {
      return null
    }
  }
}

function named(signature: string, args: Struct): NamedEvent {
  return { signature, abi: sigEvent(signature, args) }
}

// Canonical any-address signatures prevent ordinary token and AMM events from
// losing their signatures merely because their contract address is unknown.
const CANONICAL: NamedEvent[] = [
  named('Transfer(address,address,uint256)', {
    from: indexed(p.address),
    to: indexed(p.address),
    value: p.uint256,
  }),
  named('Approval(address,address,uint256)', {
    owner: indexed(p.address),
    spender: indexed(p.address),
    value: p.uint256,
  }),
  named('ApprovalForAll(address,address,bool)', {
    owner: indexed(p.address),
    operator: indexed(p.address),
    approved: p.bool,
  }),
  named('TransferSingle(address,address,address,uint256,uint256)', {
    operator: indexed(p.address),
    from: indexed(p.address),
    to: indexed(p.address),
    id: p.uint256,
    value: p.uint256,
  }),
  named('TransferBatch(address,address,address,uint256[],uint256[])', {
    operator: indexed(p.address),
    from: indexed(p.address),
    to: indexed(p.address),
    ids: p.array(p.uint256),
    values: p.array(p.uint256),
  }),
  named('Deposit(address,uint256)', { dst: indexed(p.address), wad: p.uint256 }),
  named('Withdrawal(address,uint256)', { src: indexed(p.address), wad: p.uint256 }),
  named('Deposit(address,address,uint256,uint256)', {
    sender: indexed(p.address),
    owner: indexed(p.address),
    assets: p.uint256,
    shares: p.uint256,
  }),
  named('Withdraw(address,address,address,uint256,uint256)', {
    sender: indexed(p.address),
    receiver: indexed(p.address),
    owner: indexed(p.address),
    assets: p.uint256,
    shares: p.uint256,
  }),
  named('Sync(uint112,uint112)', { reserve0: p.uint112, reserve1: p.uint112 }),
  named('Swap(address,uint256,uint256,uint256,uint256,address)', {
    sender: indexed(p.address),
    amount0In: p.uint256,
    amount1In: p.uint256,
    amount0Out: p.uint256,
    amount1Out: p.uint256,
    to: indexed(p.address),
  }),
  named('Mint(address,uint256,uint256)', {
    sender: indexed(p.address),
    amount0: p.uint256,
    amount1: p.uint256,
  }),
  named('Burn(address,uint256,uint256,address)', {
    sender: indexed(p.address),
    amount0: p.uint256,
    amount1: p.uint256,
    to: indexed(p.address),
  }),
  named('PairCreated(address,address,address,uint256)', {
    token0: indexed(p.address),
    token1: indexed(p.address),
    pair: p.address,
    index: p.uint256,
  }),
  named('Swap(address,address,int256,int256,uint160,uint128,int24)', {
    sender: indexed(p.address),
    recipient: indexed(p.address),
    amount0: p.int256,
    amount1: p.int256,
    sqrtPriceX96: p.uint160,
    liquidity: p.uint128,
    tick: p.int24,
  }),
  named('Mint(address,address,int24,int24,uint128,uint256,uint256)', {
    sender: p.address,
    owner: indexed(p.address),
    tickLower: indexed(p.int24),
    tickUpper: indexed(p.int24),
    amount: p.uint128,
    amount0: p.uint256,
    amount1: p.uint256,
  }),
  named('Burn(address,int24,int24,uint128,uint256,uint256)', {
    owner: indexed(p.address),
    tickLower: indexed(p.int24),
    tickUpper: indexed(p.int24),
    amount: p.uint128,
    amount0: p.uint256,
    amount1: p.uint256,
  }),
  named('PoolCreated(address,address,uint24,int24,address)', {
    token0: indexed(p.address),
    token1: indexed(p.address),
    fee: indexed(p.uint24),
    tickSpacing: p.int24,
    pool: p.address,
  }),
  named('Submitted(address,uint256,address)', {
    sender: indexed(p.address),
    amount: p.uint256,
    referral: p.address,
  }),
]

const AAVE_V3_EVENTS: NamedEvent[] = [
  named('Supply(address,address,address,uint256,uint16)', {
    reserve: indexed(p.address),
    user: p.address,
    onBehalfOf: indexed(p.address),
    amount: p.uint256,
    referralCode: indexed(p.uint16),
  }),
  named('Borrow(address,address,address,uint256,uint8,uint256,uint16)', {
    reserve: indexed(p.address),
    user: p.address,
    onBehalfOf: indexed(p.address),
    amount: p.uint256,
    interestRateMode: p.uint8,
    borrowRate: p.uint256,
    referralCode: indexed(p.uint16),
  }),
  named('Repay(address,address,address,uint256,bool)', {
    reserve: indexed(p.address),
    user: indexed(p.address),
    repayer: indexed(p.address),
    amount: p.uint256,
    useATokens: p.bool,
  }),
]

export const ethereumRegistry = new EventRegistry()
ethereumRegistry.registerBySignature(CANONICAL)
ethereumRegistry.register('0xae7ab96520de3a18e5e111b5eaab095312d7fe84', CANONICAL, 'Lido')
ethereumRegistry.register('0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', CANONICAL, 'WETH')
ethereumRegistry.register('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', CANONICAL, 'USDC')
ethereumRegistry.register('0xdac17f958d2ee523a2206206994597c13d831ec7', CANONICAL, 'Tether')
ethereumRegistry.register('0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2', AAVE_V3_EVENTS, 'Aave V3')
ethereumRegistry.register('0x1f98431c8ad98523631ae4a59f267346ea31f984', CANONICAL, 'Uniswap V3 Factory')
ethereumRegistry.register('0x5c69bee701ef814a2b6a3edd4b1652cb9cc5aa6f', CANONICAL, 'Uniswap V2 Factory')
ethereumRegistry.register('0xbbbbbbbbbb9cc5e90e3b3af64bdaf62c37eeffcb', CANONICAL, 'Morpho Blue')
ethereumRegistry.register('0xc3d688b66703497daa19211eedff47f25384cdc3', CANONICAL, 'Compound V3')
ethereumRegistry.register('0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0', CANONICAL, 'Lido wstETH')
ethereumRegistry.register('0xbe9895146f7af43049ca1c1ae358b0541ea49704', CANONICAL, 'Coinbase cbETH')
ethereumRegistry.register('0xae78736cd615f374d3085123a210448e74fc6393', CANONICAL, 'Rocket Pool rETH')
ethereumRegistry.register('0x6b175474e89094c44da98b954eedeac495271d0f', CANONICAL, 'MakerDAO DAI')
ethereumRegistry.register('0x2260fac5e5542a773aa44fbcfedf7c193bc2c599', CANONICAL, 'WBTC')
ethereumRegistry.register('0x35d1f5b5b0bfbdaefdefdedeae1de65a56b01aec', CANONICAL, 'ether.fi eETH')

export const polygonRegistry = new EventRegistry()
polygonRegistry.registerBySignature(CANONICAL)
polygonRegistry.register('0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270', CANONICAL, 'WMATIC')
polygonRegistry.register('0x2791bca1f2de4661ed88a30c99a7a9449aa84174', CANONICAL, 'USDC.e')
polygonRegistry.register('0x3c499c542cef5e3811e1192ce70d8cc03d5c3359', CANONICAL, 'USDC')
polygonRegistry.register('0xc2132d05d31c914a87c6611c10748aeb04b58e8f', CANONICAL, 'Tether')
polygonRegistry.register('0x794a61358d6845594f94dc1db02a252b5b4814ad', AAVE_V3_EVENTS, 'Aave V3')
polygonRegistry.register('0x1f98431c8ad98523631ae4a59f267346ea31f984', CANONICAL, 'Uniswap V3 Factory')
polygonRegistry.register('0x5757371414417b8c6caad45baef941abc7d3ab32', CANONICAL, 'QuickSwap Factory')
polygonRegistry.register('0x7ceb23fd6bc0add59e62ac25578270cff1b9f619', CANONICAL, 'WETH (PoS)')
polygonRegistry.register('0x8f3cf7ad23cd3cadbd9735aff958023239c6a063', CANONICAL, 'DAI (PoS)')
polygonRegistry.register('0x4d97dcd97ec945f40cf65f87097ace5ea0476045', CANONICAL, 'Polymarket CTF')
