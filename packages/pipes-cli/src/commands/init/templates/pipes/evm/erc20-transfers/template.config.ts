import { z } from 'zod'

import { getTemplateDirname } from '~/utils/fs.js'
import { TemplateReader } from '~/utils/template-reader.js'

import { extractCreateTableNames } from '../../../../builders/target-builder/shared.js'
import { type Deployment, DeploymentSchema } from '../../../contract-params.js'
import { defineTemplate } from '../../../define-template.js'
import { erc20DecoderGroups, renderTransformer } from './templates/transformer.js'

const templateReader = new TemplateReader(getTemplateDirname('evm'), 'erc20-transfers')

const defaults = {
  deployments: [{ address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', range: { from: '12,369,621' } }],
}

export const Erc20TransfersPipeTemplateParamsSchema = z
  .object({
    deployments: z
      .array(DeploymentSchema)
      .min(1)
      .default(defaults.deployments)
      .describe('ERC-20 token deployments to track, each with its own block range'),
  })
  // Old-shape configs ({ contractAddresses, range }) must be rejected loudly —
  // stripping them would silently index the schema-default deployment instead.
  .strict()
export type Erc20TransfersPipeTemplateParams = z.infer<typeof Erc20TransfersPipeTemplateParamsSchema>

export const erc20TransfersTemplate = defineTemplate({
  id: 'erc20Transfers',
  name: 'ERC-20 Transfers',
  networkType: 'evm',
  paramsSchema: Erc20TransfersPipeTemplateParamsSchema,
  defaultParams: defaults,
  async prompt(ctx) {
    const reference = defaults.deployments[0]!
    const address = (await ctx.text('ERC-20 contract address', reference.address)).trim()
    const deployments: Deployment[] = [
      { address, range: await ctx.blockRange('Block range', { contractAddresses: [address] }) },
    ]

    while (await ctx.confirm('Add another ERC-20 deployment?', false)) {
      const extraAddress = (await ctx.text('ERC-20 contract address')).trim()
      deployments.push({
        address: extraAddress,
        range: await ctx.blockRange(`Block range for ${extraAddress}`, { contractAddresses: [extraAddress] }),
      })
    }

    return { deployments }
  },
  render(params) {
    const clickhouseTable = templateReader.readClickhouseTable()
    const tableNames = extractCreateTableNames(clickhouseTable)

    return {
      transformer: renderTransformer(params),
      postgresSchema: templateReader.readPgTable(),
      clickhouseTable,
      decoderIds: erc20DecoderGroups(params).map((g) => g.decoderId),
      // Every range-group decoder writes into the same static table(s).
      tables: erc20DecoderGroups(params).flatMap((group) =>
        tableNames.map((table) => ({ decoderId: group.decoderId, table })),
      ),
    }
  },
})
