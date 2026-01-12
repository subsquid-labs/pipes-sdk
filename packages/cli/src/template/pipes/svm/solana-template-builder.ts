import Mustache from 'mustache'
import { TemplateBuilder, TemplateValues } from '~/template/index.js'

export const template = `{{#mergedImports}}
{{{.}}}
{{/mergedImports}}

{{#templates}}
{{^excludeFromComposite}}
{{{transformer}}}

{{/excludeFromComposite}}
{{/templates}}
{{#customContracts}}
const {{{compositeKey}}} = solanaInstructionDecoder({
  range: { from: 'latest' },
  programId: [programId],
  /**
   * Or optionally use only a subset of events by passing the events object directly:
   * \`\`\`ts
   * instructions: {
   *   transfers: myProgramInstructions.instructions.Swap,
   * },
   * \`\`\`
   */
  instructions: {{{eventsAlias}}}, 
})
{{/customContracts}}

export async function main() {
  await solanaPortalSource({
    portal: 'https://portal.sqd.dev/datasets/{{network}}',
  })
  .pipeComposite({
{{#templates}}
{{^excludeFromComposite}}
    {{{variableName}}},
{{/excludeFromComposite}}
{{/templates}}
{{#customContracts}}
    {{{compositeKey}}},
{{/customContracts}}
  })
  /**
   * Start transforming the data coming from the source.
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

export class SolanaTemplateBuilder extends TemplateBuilder<'svm'> {
  renderTemplate(templateValues: TemplateValues): string {
    return Mustache.render(template, templateValues)
  }
}
