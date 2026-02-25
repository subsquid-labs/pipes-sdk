import Mustache from 'mustache'
import { BaseTransformerBuilder, TemplateValues } from './base-transformer-builder.js'

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
  })
  .pipeComposite({
{{#transformerTemplates}}
{{#templateId}}
    {{{templateId}}},
{{/templateId}}
{{#templateIds}}
    {{{.}}},
{{/templateIds}}
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
    return ['import { evmPortalSource } from "@subsquid/pipes/evm"']
  }

  runPostSetups() {
    this.config.templates.map(async (t) => {
    })
  }

  getTransformerTemplates() {
    return Promise.all(
      this.config.templates.map(async (t) => {
        const code = t.renderTransformers()
        const decoderIds = t.getDecoderIds()

        if (decoderIds.length === 1) {
          return { code, templateId: decoderIds[0] }
        }
        return { code, templateIds: decoderIds }
      }),
    )
  }
}
