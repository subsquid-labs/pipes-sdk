import Mustache from 'mustache'
import { TemplateBuilder, TemplateValues } from '~/template/index.js'

export const template = `{{#mergedImports}}
{{{.}}}
{{/mergedImports}}

{{#templates}}
{{{transformer}}}

{{/templates}}
{{#customContracts}}
const {{{compositeKey}}} = evmDecoder({
  range: { from: 'latest' },
  contracts: ["{{{address}}}"],
  /**
   * Or optionally use only a subset of events by passing the events object directly:
   * \`\`\`ts
   * events: {
   *   transfers: erc20.events.Transfer,
   * },
   * \`\`\`
   */
  events: {{{eventsAlias}}}, 
})
{{/customContracts}}

export async function main() {
  await evmPortalSource({
    portal: 'https://portal.sqd.dev/datasets/{{network}}',
  })
  .pipeComposite({
{{#templates}}
    {{{variableName}}},
{{/templates}}
{{#customContracts}}
    {{{compositeKey}}},
{{/customContracts}}
  })
  /**
   * Start transforming the data coming from the source.
   * \`\`\`ts
   * .pipe(({ contract1 }) => {
   *   return contract1.SomeEvent.map(e => {
   *     // do something
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
