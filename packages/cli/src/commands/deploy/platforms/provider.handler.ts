export abstract class ProviderDeployHandler {
  abstract deploy(): Promise<void>
}
