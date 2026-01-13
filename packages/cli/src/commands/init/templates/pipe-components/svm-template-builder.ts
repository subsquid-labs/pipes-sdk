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
  await solanaPortalSource({
    portal: 'https://portal.sqd.dev/datasets/{{network}}',
  })
  .pipeComposite({
{{#transformerTemplates}}
    {{{templateId}}},
{{/transformerTemplates}}
  })
  /**
   * Or optionally use only a subset of events by passing the events object directly:
   * \`\`\`ts
   * .pipe(({ contract1 }) => {
   *   return contract1.SomeInstruction.map(e => {
   *     // do something
   *   })
   * })
   * \`\`\`
   */
  .pipeTo({{{sinkTemplate}}})
}

void main()
`

export class SvmTemplateBuilder extends TemplateBuilder<'svm'> {
  renderTemplate(templateValues: TemplateValues): string {
    return Mustache.render(template, templateValues)
  }
}
