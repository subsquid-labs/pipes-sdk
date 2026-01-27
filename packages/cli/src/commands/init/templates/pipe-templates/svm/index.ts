import { z } from 'zod'
import { PipeTemplateMeta } from '~/types/init.js'

export const CustomPipeTemplateParamsSchema = z.object({
  contractAddresses: z.array(z.string()).describe('The contract addresses to track.'),
  events: z.array(z.string()).describe('The events to track'),
})

const custom: PipeTemplateMeta<'svm', typeof CustomPipeTemplateParamsSchema> = {
  templateId: 'custom',
  templateName: 'Custom' as const,
  networkType: 'svm' as const,
  paramsSchema: CustomPipeTemplateParamsSchema,
  templateFn(network, sink, params) {
    return {
      templateId: this.templateId,
      networkType: this.networkType,
      network,
      params,
      sink,
    }
  },
}

export const TokenBalancesPipeTemplateParamsSchema = z.object({
  contractAddresses: z
    .array(z.string())
    .default(['0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'])
    .describe('The contract addresses to track'),
})
const tokenBalances: PipeTemplateMeta<'svm', typeof TokenBalancesPipeTemplateParamsSchema> = {
  templateId: 'tokenBalances' as const,
  templateName: 'Token balances' as const,
  networkType: 'svm' as const,
  paramsSchema: TokenBalancesPipeTemplateParamsSchema,
  templateFn(network, sink, params) {
    return {
      templateId: this.templateId,
      networkType: this.networkType,
      network,
      params,
      sink,
    }
  },
}

export const svmTemplates = {
  custom,
  tokenBalances,
} as const satisfies Record<string, PipeTemplateMeta<'svm', any>>

export type SvmTemplateIds = keyof typeof svmTemplates
export type SvmTemplates = typeof svmTemplates
