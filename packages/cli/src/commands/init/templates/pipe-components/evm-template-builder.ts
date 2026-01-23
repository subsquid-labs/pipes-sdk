import Mustache from 'mustache'
import { TemplateBuilder, TemplateValues } from './template-builder.js'

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

export class EvmTemplateBuilder extends TemplateBuilder<'evm'> {
  renderTemplate(templateValues: TemplateValues): string {
    return Mustache.render(template, templateValues)
  }
}
