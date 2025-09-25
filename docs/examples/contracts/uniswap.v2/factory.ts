import { event, indexed } from '@subsquid/evm-abi'
import * as p from '@subsquid/evm-codec'

export const events = {
  PairCreated: event(
    '0x0d3648bd0f6ba80134a33ba9275ac585d9d315f0ad8355cddefde31afa28d0e9'.toLowerCase(),
    'PairCreated(address,address,address,uint256)',
    {
      token0: indexed(p.address),
      token1: indexed(p.address),
      pair: p.address,
      noname: p.uint256,
    },
  ),
}
