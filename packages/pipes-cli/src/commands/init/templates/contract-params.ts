import z from 'zod'

import type { ContractMetadata, RawAbiEvent } from '~/services/sqd-abi.js'
import type { BlockRange } from '~/utils/block-range-prompt.js'

/**
 * Shared config vocabulary for templates that track user-supplied contracts.
 *
 * The hierarchy is contract-first: a contract is an ABI-level entity (name +
 * tracked events) with one or more deployments, and each deployment is a
 * concrete address plus its own block range. The network is currently inherited
 * from the project's `defaultNetwork`; a per-deployment `network` field is the
 * planned (additive) extension for multichain pipes.
 */

const RawInputSchema: z.ZodType<{ name: string; type: string; components?: unknown }> = z.lazy(() =>
  z.object({
    name: z.string(),
    type: z.string(),
    components: z.array(RawInputSchema).optional(),
  }),
)

export const RawAbiEventSchema = z.object({ name: z.string(), type: z.string(), inputs: z.array(RawInputSchema) })

export const BlockRangeSchema = z.object({
  from: z.string(),
  to: z.string().optional(),
})

export const DeploymentSchema = z
  .object({
    address: z.string().describe('Deployed contract address'),
    range: BlockRangeSchema.default({ from: 'latest' }).describe('Block range to index for this deployment'),
  })
  .strict()

export const ContractSchema = z
  .object({
    contractName: z.string().describe('Contract name (ABI-level identity)'),
    contractEvents: z.array(RawAbiEventSchema).describe('ABI events to track (shared by all deployments)'),
    deployments: z.array(DeploymentSchema).min(1).describe('Deployed instances of this contract'),
  })
  .strict()

export type Deployment = z.infer<typeof DeploymentSchema>
export type ContractParams = z.infer<typeof ContractSchema>

/** A single (contract, deployment) pair — the flat shape decoders and renderers consume. */
export interface ContractDeployment extends ContractMetadata {
  range?: BlockRange
  /**
   * The reference deployment's address: the one the ABI was fetched from and typegen
   * ran against. Import paths must use it — other deployments have no typegen output.
   */
  typegenAddress: string
}

/**
 * Flattens the contract-first shape into per-deployment entries. Events and name
 * are contract-level and repeat per deployment; address and range are
 * deployment-level.
 */
export function flattenContracts(
  contracts: { contractName: string; contractEvents: RawAbiEvent[]; deployments: Deployment[] }[],
): ContractDeployment[] {
  return contracts.flatMap((contract) =>
    contract.deployments.map((deployment) => ({
      contractName: contract.contractName,
      contractEvents: contract.contractEvents,
      contractAddress: deployment.address,
      range: deployment.range,
      typegenAddress: referenceAddress(contract),
    })),
  )
}

/** The reference deployment: the address a contract's ABI was fetched from (and typegen input). */
export function referenceAddress(contract: { deployments: Deployment[] }): string {
  return contract.deployments[0]!.address
}
