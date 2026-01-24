import Mustache from 'mustache'
import { renderTransformerTemplate } from '../../pipe-templates/evm/custom/transformer.js'
import { BaseTemplateBuilder, TemplateValues } from './base-template-builder.js'

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
    {{{templateId}}},
{{/transformerTemplates}}
  })
  .pipeTo({{{sinkTemplate}}})
}

void main()
`

export class EvmTemplateBuilder extends BaseTemplateBuilder {
  // TODO: move deduplication logic to this function
  renderTemplate(templateValues: TemplateValues) {
    return Mustache.render(template, templateValues)
  }

  getNetworkImports() {
    return ['import { evmPortalSource } from "@subsquid/pipes/evm"']
  }

  getTransformerTemplates() {
    return Promise.all(
      this.config.templates.map(async (template) => {
        if (template.templateId === 'custom') {
          return {
            code: renderTransformerTemplate(this.config),
            templateId: 'custom',
          }
        }
        return { code: template.code, templateId: template.templateId }
      }),
    )
  }
}
