import { NetworkType, networkTypes } from '~/types/init.js'
import { templates } from './templates/pipe-components/transformer-builder/index.js'

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

export class TemplateFileNotFoundError extends Error {
  constructor(path: string) {
    super(
      `File not found for template.
File path: ${path}`,
    )
  }
}

export class UnexpectedTemplateFileError extends Error {
  constructor(path: string) {
    super(
      `Unexpected file format for template.
Expected a file or directory but got: ${path}`,
    )
  }
}

export class ProjectAlreadyExistError extends Error {
  constructor(path: string) {
    super(
      `Project folder already exist. Please, select a new location
Path: ${path}
`,
    )
  }
}
