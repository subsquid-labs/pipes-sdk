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

export class SvmTransformerBuilder extends BaseTransformerBuilder<'svm'> {
  getTemplate(): string {
    return template
  }

  getNetworkImports(): string[] {
    return ['import { solanaPortalSource } from "@subsquid/pipes/solana"']
  }

  getTransformerTemplates() {
    return Promise.all(
      this.config.templates.map(async (template) => {
        return { code: template.renderFns.transformers(), templateId: template.templateId }
      }),
    )
  }

}
