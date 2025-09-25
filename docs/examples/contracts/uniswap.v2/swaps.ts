import { event, indexed } from '@subsquid/evm-abi'
import * as p from '@subsquid/evm-codec'

export const events = {
  Swap: event(
    '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822',
    'Swap(address,uint256,uint256,uint256,uint256,address)',
    {
      sender: indexed(p.address),
      amount0In: p.uint256,
      amount1In: p.uint256,
      amount0Out: p.uint256,
      amount1Out: p.uint256,
      to: indexed(p.address),
    },
  ),
}
