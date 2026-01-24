import Mustache from 'mustache'
import { renderTransformerTemplate } from '../../pipe-templates/svm/custom/transformer.js'
import { BaseTemplateBuilder, TemplateValues } from './base-template-builder.js'

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

export class SvmTemplateBuilder extends BaseTemplateBuilder {
  renderTemplate(templateValues: TemplateValues): string {
    return Mustache.render(template, templateValues)
  }

  getNetworkImports(): string[] {
    return ['import { solanaPortalSource } from "@subsquid/pipes/solana"']
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
