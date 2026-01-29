import { DeployOptions } from '~/types/deploy.js'

export class DeployHandler {
  constructor(private options: DeployOptions) {}

  async handle(): Promise<void> {
    if (this.options.provider === 'railway') {
      const railwayService = new RailwayService()
      await railwayService.deployToRailway()
    } else if (this.options.provider === 'aws') {
      throw new Error('AWS deployment not yet implemented')
    } else {
      throw new Error(`Unknown provider: ${this.options.provider}`)
    }
  }
}
