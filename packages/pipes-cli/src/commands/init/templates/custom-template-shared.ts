import { RawAbiEvent, SqdAbiService } from '~/services/sqd-abi.js'
import type { NetworkType } from '~/types/init.js'

import { type ContractParams, type Deployment, referenceAddress } from './contract-params.js'
import type { PromptContext } from './define-template.js'
import type { TemplateContext } from './template.js'

interface CustomPromptWording {
  networkType: NetworkType
  /** 'contract' (EVM) or 'program' (SVM) — used in every prompt message. */
  entity: string
  /** 'events' (EVM) or 'instructions' (SVM). */
  members: string
  /** EVM only: lets the range prompt offer the deployment block. */
  rangeKnowsAddresses: boolean
}

/**
 * The contract-first prompt flow shared by the EVM and SVM custom templates:
 * reference deployment → ABI/IDL fetch → member selection (contract level) →
 * per-deployment ranges via "add another" loops.
 */
export function customContractsPrompt(wording: CustomPromptWording) {
  const { networkType, entity, members, rangeKnowsAddresses } = wording
  const rangeOpts = (address: string) => (rangeKnowsAddresses ? { contractAddresses: [address] } : undefined)

  async function promptOne(ctx: PromptContext): Promise<ContractParams> {
    // Contract level: the reference deployment's address is how we obtain the ABI/IDL.
    const capitalized = entity.charAt(0).toUpperCase() + entity.slice(1)
    const address = (await ctx.text(`${capitalized} address`)).trim()
    if (address.includes(',')) {
      throw new Error(
        `One address at a time: enter the reference deployment first, further deployments and ${entity}s are added in the follow-up prompts.`,
      )
    }

    const [metadata] = await ctx.abiService.getContractData(networkType, ctx.network, [address])

    const choices = metadata!.contractEvents
      .map((event) => ({ name: event.name, value: event }))
      .sort((a, b) => a.name.localeCompare(b.name))
    const events = (await ctx.checkbox(
      `Pick the ${members} to track for ${metadata!.contractName}`,
      choices,
    )) as RawAbiEvent[]

    // Deployment level: the reference deployment first, then any further ones.
    const deployments: Deployment[] = [
      { address, range: await ctx.blockRange(`Block range for ${metadata!.contractName}`, rangeOpts(address)) },
    ]

    while (await ctx.confirm(`Add another deployment of ${metadata!.contractName}?`, false)) {
      const extraAddress = (await ctx.text(`Deployment address of ${metadata!.contractName}`)).trim()
      deployments.push({
        address: extraAddress,
        range: await ctx.blockRange(`Block range for ${extraAddress}`, rangeOpts(extraAddress)),
      })
    }

    return {
      contractName: metadata!.contractName,
      contractEvents: events,
      deployments,
    }
  }

  return async function prompt(ctx: PromptContext): Promise<{ contracts: ContractParams[] }> {
    const contracts: ContractParams[] = [await promptOne(ctx)]

    while (await ctx.confirm(`Add another ${entity}?`, false)) {
      contracts.push(await promptOne(ctx))
    }

    // Duplicate-name resolution is centralized in prepareConfig, which runs for
    // both the interactive and --config paths.
    return { contracts }
  }
}

/** Typegen needs one deployment per contract — every deployment shares the ABI/IDL. */
export function customTypegenPostSetup<N extends NetworkType>(networkType: N) {
  return async function postSetup(params: { contracts: ContractParams[] }, ctx: TemplateContext<N>) {
    const abiService = ctx.abiService ?? new SqdAbiService()
    await abiService.generateTypes(networkType, ctx.network, ctx.projectPath, params.contracts.map(referenceAddress))
  }
}
