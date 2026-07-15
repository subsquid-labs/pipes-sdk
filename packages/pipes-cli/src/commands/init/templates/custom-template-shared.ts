import chalk from 'chalk'

import { RawAbiEvent, SqdAbiService } from '~/services/sqd-abi.js'
import type { NetworkType } from '~/types/init.js'

import { type ContractParams, type Deployment, referenceAddress } from './contract-params.js'
import type { PromptContext } from './define-template.js'
import { withPromptRetry } from './prompt-resilience.js'
import type { TemplateContext } from './template.js'

interface CustomPromptWording {
  networkType: NetworkType
  /** 'contract' (EVM) or 'program' (SVM) — used in every prompt message. */
  entity: string
  /** 'events' (EVM) or 'instructions' (SVM). */
  members: string
  /** The interface artifact we read the members from: 'ABI' (EVM) or 'IDL' (SVM). */
  interfaceNoun: string
  /** Where that interface comes from, e.g. 'an Etherscan-verified contract'. */
  verifiedSource: string
  /** EVM only: lets the range prompt offer the deployment block. */
  rangeKnowsAddresses: boolean
}

/**
 * The contract-first prompt flow shared by the EVM and SVM custom templates:
 * reference deployment → ABI/IDL fetch → member selection (contract level) →
 * per-deployment ranges via "add another" loops. The reference-deployment step
 * is retry-wrapped so a bad address or unverified contract re-prompts instead
 * of aborting the session.
 */
export function customContractsPrompt(wording: CustomPromptWording) {
  const { networkType, entity, members, interfaceNoun, verifiedSource, rangeKnowsAddresses } = wording
  const rangeOpts = (address: string) => (rangeKnowsAddresses ? { contractAddresses: [address] } : undefined)

  const intro = `A ${entity} here is an interface: we read the ${interfaceNoun} of ${verifiedSource} to list the ${members} you can track. Enter a reference deployment address — you'll add concrete deployments next.`
  const addressHint = chalk.dim(`— we'll fetch the ${interfaceNoun} of ${verifiedSource}`)

  async function promptReference(
    ctx: PromptContext,
  ): Promise<{ contractName: string; events: RawAbiEvent[]; address: string }> {
    // Contract level: the reference deployment's address is how we obtain the ABI/IDL.
    // Retry-wrapped so an unverified/typo'd address or an interface with no
    // trackable members re-prompts rather than killing init.
    return withPromptRetry(ctx, `Re-enter the ${entity} address`, async () => {
      const address = (await ctx.text(`Reference ${entity} address ${addressHint}`)).trim()
      if (address.includes(',')) {
        throw new Error(
          `One address at a time: enter the reference deployment first, further deployments and ${entity}s are added in the follow-up prompts.`,
        )
      }

      const [metadata] = await ctx.abiService.getContractData(networkType, ctx.network, [address])
      if (metadata!.contractEvents.length === 0) {
        throw new Error(
          `${metadata!.contractName} exposes no ${members} in its ${interfaceNoun}. Pick a different ${entity}.`,
        )
      }

      // EVM proxies resolve to an implementation ABI: the events came from a
      // different address than the one entered, so say which.
      if (networkType === 'evm' && metadata!.contractAddress.toLowerCase() !== address.toLowerCase()) {
        console.log(
          chalk.dim(`  ↳ ${address} is a proxy — fetched the implementation ABI at ${metadata!.contractAddress}`),
        )
      }

      const choices = metadata!.contractEvents
        .map((event) => ({ name: event.name, value: event }))
        .sort((a, b) => a.name.localeCompare(b.name))
      const events = (await ctx.checkbox(
        `Pick the ${members} to track for ${metadata!.contractName}`,
        choices,
      )) as RawAbiEvent[]

      return { contractName: metadata!.contractName, events, address }
    })
  }

  async function promptOne(ctx: PromptContext): Promise<ContractParams> {
    const { contractName, events, address } = await promptReference(ctx)

    // Deployment level: the reference deployment first, then any further ones.
    const deployments: Deployment[] = [
      { address, range: await ctx.blockRange(`Block range for ${contractName}`, rangeOpts(address)) },
    ]

    while (await ctx.confirm(`Add another deployment of ${contractName}?`, false)) {
      const extraAddress = (await ctx.text(`Deployment address of ${contractName}`)).trim()
      deployments.push({
        address: extraAddress,
        range: await ctx.blockRange(`Block range for ${extraAddress}`, rangeOpts(extraAddress)),
      })
    }

    return {
      contractName,
      contractEvents: events,
      deployments,
    }
  }

  return async function prompt(ctx: PromptContext): Promise<{ contracts: ContractParams[] }> {
    console.log('')
    console.log(chalk.dim(intro))
    console.log('')

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
