import z from 'zod'

import { NetworkType, packageManagerTypes, sinkTypes } from '~/types/init.js'

import { TemplateNotFoundError } from '../init.errors.js'
import { getTemplate, getTemplates } from '../templates/registry.js'
import { getPortalNetworkSlugs } from './networks.js'

function getTemplateSchemas<N extends NetworkType>(networkType: N) {
  const networkTemplates = getTemplates(networkType)
  const options = networkTemplates.map((template) =>
    z
      .object({
        templateId: z.literal(template.id),
        ...(template.paramsSchema ? { params: template.paramsSchema } : {}),
      })
      .strict(),
  )

  if (options.length < 2) {
    throw new Error(`Expected at least two templates for network ${networkType}, got ${options.length}`)
  }

  const [first, second, ...rest] = options
  return z.array(z.discriminatedUnion('templateId', [first!, second!, ...rest]))
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
      const template = getTemplate(networkType, t.templateId)
      if (!template) throw new TemplateNotFoundError(t.templateId, networkType)
      return { template, params: t.params }
    }),
  }
})
