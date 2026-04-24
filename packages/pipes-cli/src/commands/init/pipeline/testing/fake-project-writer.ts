import path from 'node:path'

import type { ProjectWriter } from '~/utils/project-writer.js'

export type CreateFileCall = { relativePath: string; content: string }
export type CopyFileCall = { absoluteSourcePath: string; relativeTargetPath: string }

export class FakeProjectWriter {
  readonly createFileCalls: CreateFileCall[] = []
  readonly copyFileCalls: CopyFileCall[] = []
  readonly executeCommandCalls: string[] = []
  private readonly projectAbsolutePath: string

  constructor(projectFolder = '/tmp/fake-project') {
    this.projectAbsolutePath = path.resolve(projectFolder)
  }

  getAbsolutePath(): string {
    return this.projectAbsolutePath
  }

  createFile(relativePath: string, content: string): void {
    this.createFileCalls.push({ relativePath, content })
  }

  copyFile(absoluteSourcePath: string, relativeTargetPath: string): void {
    this.copyFileCalls.push({ absoluteSourcePath, relativeTargetPath })
  }

  executeCommand(command: string): Promise<{ stdout: string; stderr: string }> {
    this.executeCommandCalls.push(command)
    return Promise.resolve({ stdout: '', stderr: '' })
  }

  asProjectWriter(): ProjectWriter {
    return this as unknown as ProjectWriter
  }
}
