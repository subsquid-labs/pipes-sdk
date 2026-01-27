import { exec } from 'child_process'
import { mkdirSync, writeFileSync, existsSync, statSync, cpSync, copyFileSync } from 'fs'
import path from 'path'
import { promisify } from 'util'
import { TemplateFileNotFoundError, UnexpectedTemplateFileError } from '~/commands/init/init.errors.js'

const execAsync = promisify(exec)

export class ProjectWriter {
  private readonly projectAbsolutePath: string
  constructor(projectFolder: string) {
    this.projectAbsolutePath = path.resolve(projectFolder)
  }

  getAbsolutePath() {
    return this.projectAbsolutePath
  }

  createFile(relativePath: string, content: string) {
    const filePath = path.join(this.projectAbsolutePath, relativePath)
    mkdirSync(path.dirname(filePath), { recursive: true })
    writeFileSync(filePath, content)
  }

  copyFile(absoluteSourcePath: string, relativeTargetPath: string) {
    const absoluteTargetFilePath = path.join(this.projectAbsolutePath, relativeTargetPath)

    if (!existsSync(absoluteSourcePath)) throw new TemplateFileNotFoundError(absoluteSourcePath)

    const sourceStat = statSync(absoluteSourcePath)

    if (sourceStat.isDirectory()) {
      cpSync(absoluteSourcePath, absoluteTargetFilePath, { recursive: true })
    } else if (sourceStat.isFile()) {
      mkdirSync(path.dirname(absoluteTargetFilePath), { recursive: true })
      copyFileSync(absoluteSourcePath, absoluteTargetFilePath)
    } else {
      throw new UnexpectedTemplateFileError(absoluteTargetFilePath)
    }
  }

  executeCommand(command: string) {
    return execAsync(command, {
      cwd: this.projectAbsolutePath,
    })
  }
}
