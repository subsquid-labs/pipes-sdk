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
    {{{name}}},
{{/transformerTemplates}}
  })
  /**
   * You can further transform the data coming from the source
   * \`\`\`ts
   * .pipe(({ contract1 }) => {
   *   return contract1.SomeEvent.map(e => {
   *     // some transformation logic
   *   })
   * })
   * \`\`\`
   */
  .pipeTo({{{sinkTemplate}}})
}

void main()
`

export class EvmTemplateBuilder extends TemplateBuilder<'evm'> {
  renderTemplate(templateValues: TemplateValues): string {
    return Mustache.render(template, templateValues)
  }
}
