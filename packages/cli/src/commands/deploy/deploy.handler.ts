import { Provider } from '~/types/deploy.js'

import { ProviderDeployHandler } from './platforms/provider.handler.js'
import { RailwayDeployHandler } from './platforms/railway.handler.js'
import { DeployOptions } from './deploy.schema.js'

const deployHandler: Record<Provider, ProviderDeployHandler> = {
  railway: new RailwayDeployHandler(),
}

export class DeployHandler {
  constructor(private options: DeployOptions) {}

  async handle(): Promise<void> {
    console.log('provider', this.options.provider)
    deployHandler[this.options.provider].deploy()
  }
}
