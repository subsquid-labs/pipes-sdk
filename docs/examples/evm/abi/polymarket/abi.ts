import { event, indexed } from '@subsquid/evm-abi'
import * as p from '@subsquid/evm-codec'

// --- ABIs ---
export const exchangeEvents = {
  OrderFilled: event(
    '0xd0a08e8c493f9c94f29311604c9de1b4e8c8d4c06bd0c789af57f2d65bfec0f6',
    'OrderFilled(bytes32,address,address,uint256,uint256,uint256,uint256,uint256)',
    {
      orderHash: indexed(p.bytes32),
      maker: indexed(p.address),
      taker: indexed(p.address),
      makerAssetId: p.uint256,
      takerAssetId: p.uint256,
      makerAmountFilled: p.uint256,
      takerAmountFilled: p.uint256,
      fee: p.uint256,
    },
  ),
  OrdersMatched: event(
    '0x63bf4d16b7fa898ef4c4b2b6d90fd201e9c56313b65638af6088d149d2ce956c',
    'OrdersMatched(bytes32,address,uint256,uint256,uint256,uint256)',
    {
      takerOrderHash: indexed(p.bytes32),
      takerOrderMaker: indexed(p.address),
      makerAssetId: p.uint256,
      takerAssetId: p.uint256,
      makerAmountFilled: p.uint256,
      takerAmountFilled: p.uint256,
    },
  ),
  TokenRegistered: event(
    '0xbc9a2432e8aeb48327246cddd6e872ef452812b4243c04e6bfb786a2cd8faf0d',
    'TokenRegistered(uint256,uint256,bytes32)',
    {
      token0: indexed(p.uint256),
      token1: indexed(p.uint256),
      conditionId: indexed(p.bytes32),
    },
  ),
}

export const ctfEvents = {
  ConditionPreparation: event(
    '0xab3760c3bd2bb38b5bcf54dc79802ed67338b4cf29f3054ded67ed24661e4177',
    'ConditionPreparation(bytes32,address,bytes32,uint256)',
    {
      conditionId: indexed(p.bytes32),
      oracle: indexed(p.address),
      questionId: indexed(p.bytes32),
      outcomeSlotCount: p.uint256,
    },
  ),
  PositionSplit: event(
    '0x2e6bb91f8cbcda0c93623c54d0403a43514fabc40084ec96b6d5379a74786298',
    'PositionSplit(address,address,bytes32,bytes32,uint256[],uint256)',
    {
      stakeholder: indexed(p.address),
      collateralToken: p.address,
      parentCollectionId: indexed(p.bytes32),
      conditionId: indexed(p.bytes32),
      partition: p.array(p.uint256),
      amount: p.uint256,
    },
  ),
  PositionsMerge: event(
    '0x6f13ca62553fcc2bcd2372180a43949c1e4cebba603901ede2f4e14f36b282ca',
    'PositionsMerge(address,address,bytes32,bytes32,uint256[],uint256)',
    {
      stakeholder: indexed(p.address),
      collateralToken: p.address,
      parentCollectionId: indexed(p.bytes32),
      conditionId: indexed(p.bytes32),
      partition: p.array(p.uint256),
      amount: p.uint256,
    },
  ),
}
