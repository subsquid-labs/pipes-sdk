import { NetworkType, networkTypes } from '~/types/init.js'
import { templates } from './templates/pipe-components/template-builder.js'

export class TemplateNotFoundError extends Error {
  constructor(templateId: unknown, network: NetworkType) {
    super(
      `Template '${templateId}' not found for ${network.toUpperCase()} networks
The available values templates for this blockchain are:
${Object.keys(templates[network])
  .map((id) => `  - ${id}`)
  .join('\n')}
  `,
    )
  }
}

export class InvalidNetworkTypeError extends Error {
  constructor(network: string) {
    super(InvalidNetworkTypeError.getErrorMessage(network))
  }

  static getErrorMessage(network: unknown) {
    return `Network type '${network}' is invalid.
The available values network types are:
${networkTypes.map((type) => `  - ${type.value}`).join('\n')}
    `
  }
}
