import { event } from '../abi.support'
import {
  AddLiquidity as AddLiquidity_,
  BootstrapLiquidity as BootstrapLiquidity_,
  ClaimFee as ClaimFee_,
  CloseConfig as CloseConfig_,
  CreateConfig as CreateConfig_,
  CreateLockEscrow as CreateLockEscrow_,
  Lock as Lock_,
  MigrateFeeAccount as MigrateFeeAccount_,
  OverrideCurveParam as OverrideCurveParam_,
  PartnerClaimFees as PartnerClaimFees_,
  PoolCreated as PoolCreated_,
  PoolEnabled as PoolEnabled_,
  PoolInfo as PoolInfo_,
  RemoveLiquidity as RemoveLiquidity_,
  SetPoolFees as SetPoolFees_,
  Swap as Swap_,
  TransferAdmin as TransferAdmin_,
  WithdrawProtocolFees as WithdrawProtocolFees_,
} from './types'

export type AddLiquidity = AddLiquidity_

export const AddLiquidity = event(
  {
    d8: '0x1f5e7d5ae3343dba',
  },
  AddLiquidity_,
)

export type RemoveLiquidity = RemoveLiquidity_

export const RemoveLiquidity = event(
  {
    d8: '0x74f461e8671f983a',
  },
  RemoveLiquidity_,
)

export type BootstrapLiquidity = BootstrapLiquidity_

export const BootstrapLiquidity = event(
  {
    d8: '0x797f26885c370ef7',
  },
  BootstrapLiquidity_,
)

export type Swap = Swap_

export const Swap = event(
  {
    d8: '0x516ce3becdd00ac4',
  },
  Swap_,
)

export type SetPoolFees = SetPoolFees_

export const SetPoolFees = event(
  {
    d8: '0xf51ac6a458124b09',
  },
  SetPoolFees_,
)

export type PoolInfo = PoolInfo_

export const PoolInfo = event(
  {
    d8: '0xcf145761fbd4ea2d',
  },
  PoolInfo_,
)

export type TransferAdmin = TransferAdmin_

export const TransferAdmin = event(
  {
    d8: '0xe4a983f43d3841fe',
  },
  TransferAdmin_,
)

export type OverrideCurveParam = OverrideCurveParam_

export const OverrideCurveParam = event(
  {
    d8: '0xf714a5f84b0536f6',
  },
  OverrideCurveParam_,
)

export type PoolCreated = PoolCreated_

export const PoolCreated = event(
  {
    d8: '0xca2c295868dc9d52',
  },
  PoolCreated_,
)

export type PoolEnabled = PoolEnabled_

export const PoolEnabled = event(
  {
    d8: '0x02971253cc865cbf',
  },
  PoolEnabled_,
)

export type MigrateFeeAccount = MigrateFeeAccount_

export const MigrateFeeAccount = event(
  {
    d8: '0xdfeae81afc69b47d',
  },
  MigrateFeeAccount_,
)

export type CreateLockEscrow = CreateLockEscrow_

export const CreateLockEscrow = event(
  {
    d8: '0x4a5e6a8d3111626d',
  },
  CreateLockEscrow_,
)

export type Lock = Lock_

export const Lock = event(
  {
    d8: '0xdcb743d799cf38ea',
  },
  Lock_,
)

export type ClaimFee = ClaimFee_

export const ClaimFee = event(
  {
    d8: '0x4b7a9a308c4a7ba3',
  },
  ClaimFee_,
)

export type CreateConfig = CreateConfig_

export const CreateConfig = event(
  {
    d8: '0xc7980a1327279d68',
  },
  CreateConfig_,
)

export type CloseConfig = CloseConfig_

export const CloseConfig = event(
  {
    d8: '0xf9b56c5904965aae',
  },
  CloseConfig_,
)

export type WithdrawProtocolFees = WithdrawProtocolFees_

export const WithdrawProtocolFees = event(
  {
    d8: '0x1ef0cfc48bef4f1c',
  },
  WithdrawProtocolFees_,
)

export type PartnerClaimFees = PartnerClaimFees_

export const PartnerClaimFees = event(
  {
    d8: '0x87830a5e77d1ca30',
  },
  PartnerClaimFees_,
)
