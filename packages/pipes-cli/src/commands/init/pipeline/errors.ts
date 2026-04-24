export class InitPipelineError extends Error {
  override readonly name = 'InitPipelineError'
  readonly stageId: string
  override readonly cause: Error

  constructor(stageId: string, cause: Error) {
    super(`Stage "${stageId}" failed: ${cause.message}`)
    this.stageId = stageId
    this.cause = cause
  }
}
