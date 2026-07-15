import { exec } from 'child_process'
import { copyFileSync, cpSync, existsSync, mkdirSync, statSync, writeFileSync } from 'fs'
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

  async executeCommand(command: string) {
    try {
      return await execAsync(command, {
        cwd: this.projectAbsolutePath,
        // Installs can print more than the default 1 MB; don't fail on buffer size.
        maxBuffer: 64 * 1024 * 1024,
      })
    } catch (error) {
      // exec puts the child's output on the error object, not in its message —
      // and package managers often write the real reason to stdout. Surface it
      // so "Command failed" isn't the whole story.
      const err = error as { stdout?: string; stderr?: string; message?: string }
      const output = [err.stderr, err.stdout]
        .map((chunk) => (chunk ?? '').toString().trim())
        .filter(Boolean)
        .join('\n')
      const detail = output || err.message || 'unknown error'

      throw new Error(`\`${command}\` failed:\n${detail}`, { cause: error })
    }
  }
}
