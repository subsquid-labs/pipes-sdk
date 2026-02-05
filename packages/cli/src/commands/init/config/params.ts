import z from 'zod'

import { NetworkType, packageManagerTypes, sinkTypes } from '~/types/init.js'

import { TemplateId, getTemplate, getTemplates } from '../builders/transformer-builder/index.js'
import { TemplateNotFoundError } from '../init.errors.js'
import { getPortalNetworkSlugs } from './networks.js'

function getTemplateSchemas<N extends NetworkType>(networkType: N) {
  const networkTemplates = getTemplates(networkType)
  const options = []
  for (const template of networkTemplates) {
    const schema = template.paramsSchema.extend({
      templateId: z.literal(template.templateId),
    })
    options.push(schema)
  }

  return z.array(z.union(options))
}

const baseSchemaRaw = z.object({
  projectFolder: z.string().min(1),
  packageManager: z.enum(packageManagerTypes.map((p) => p.value)),
  sink: z.enum(sinkTypes.map((s) => s.value)),
})

const evmConfig = baseSchemaRaw
  .extend({
    networkType: z.literal('evm'),
    network: z.enum(getPortalNetworkSlugs('evm')),
    templates: getTemplateSchemas('evm'),
  })
  .strict()

const svmConfig = baseSchemaRaw
  .extend({
    networkType: z.literal('svm'),
    network: z.enum(getPortalNetworkSlugs('svm')),
    templates: getTemplateSchemas('svm'),
  })
  .strict()

export const configJsonSchemaRaw = z.discriminatedUnion('networkType', [evmConfig, svmConfig])

export const configJsonSchema = configJsonSchemaRaw.transform((data) => {
  const networkType = data.networkType
  return {
    ...data,
    networkType,
    sink: data.sink,
    packageManager: data.packageManager,
    templates: data.templates.map((t) => {
      const template = getTemplate(networkType, t.templateId as TemplateId<NetworkType>)
      if (!template) throw new TemplateNotFoundError(t.templateId, networkType)
      return t.params ? template.setParams(t.params) : template
    }),
  }
})
