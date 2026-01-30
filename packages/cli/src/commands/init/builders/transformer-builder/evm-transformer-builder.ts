import { BaseTransformerBuilder } from './base-transformer-builder.js'

export const template = `{{#deduplicatedImports}}
{{{.}}}
{{/deduplicatedImports}}

{{{envTemplate}}}

{{#transformerTemplates}}
{{{code}}}

{{/transformerTemplates}}
export async function main() {
  await evmPortalSource({
    portal: 'https://portal.sqd.dev/datasets/{{network}}',
    metrics: metricsServer(),
  })
  .pipeComposite({
{{#transformerTemplates}}
    {{{templateId}}},
{{/transformerTemplates}}
  })
  .pipeTo({{{sinkTemplate}}})
}

void main()
`

export class EvmTransformerBuilder extends BaseTransformerBuilder<'evm'> {
  // TODO: move deduplication logic to this function
  getTemplate(): string {
    return template
  }

  getNetworkImports() {
    return [
      'import { evmPortalSource } from "@subsquid/pipes/evm"',
      'import { metricsServer } from "@subsquid/pipes/metrics/node"',
    ]
  }

  getTransformerTemplates() {
    return Promise.all(
      this.config.templates.map(async (t) => {
        return { code: t.renderTransformers(), templateId: t.templateId }
      }),
    )
  }
}
