import { BaseTransformerBuilder } from './base-transformer-builder.js'

export const template = `{{#deduplicatedImports}}
{{{.}}}
{{/deduplicatedImports}}

{{{envTemplate}}}

{{#transformerTemplates}}
{{{code}}}

{{/transformerTemplates}}
export async function main() {
  await solanaPortalSource({
    id: '{{pipeId}}',
    portal: 'https://portal.sqd.dev/datasets/{{network}}',
    outputs: {
{{#transformerTemplates}}
      {{{templateId}}},
{{/transformerTemplates}}
    },
  })
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
      this.config.templates.map((template) => {
        return { code: template.renderTransformers(), templateId: template.templateId }
      }),
    )
  }
}
