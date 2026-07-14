import { BaseTransformerBuilder } from './base-transformer-builder.js'

export const template = `{{#deduplicatedImports}}
{{{.}}}
{{/deduplicatedImports}}

{{{envTemplate}}}

{{#transformerTemplates}}
{{{code}}}

{{/transformerTemplates}}
export async function main() {
  await evmPortalStream({
    id: '{{pipeId}}',
    portal: 'https://portal.sqd.dev/datasets/{{network}}',
    outputs: {
{{#transformerTemplates}}
{{#templateId}}
      {{{templateId}}},
{{/templateId}}
{{#templateIds}}
      {{{.}}},
{{/templateIds}}
{{/transformerTemplates}}
    },
  })
  .pipeTo({{{targetTemplate}}})
}

void main()
`

export class EvmTransformerBuilder extends BaseTransformerBuilder<'evm'> {
  getTemplate(): string {
    return template
  }

  getNetworkImports() {
    return ['import { evmPortalStream } from "@subsquid/pipes/evm"']
  }

  getTransformerTemplates() {
    const ctx = {
      network: this.config.defaultNetwork,
      projectPath: '',
      networkType: this.config.networkType,
    }
    return Promise.all(
      this.config.templates.map(async ({ template, params }) => {
        const artifacts = template.render(params, ctx)
        const { transformer: code, decoderIds } = artifacts

        if (decoderIds.length === 1) {
          return { code, templateId: decoderIds[0] }
        }
        return { code, templateIds: decoderIds }
      }),
    )
  }
}
