import { exec } from 'node:child_process'
import { promisify } from 'node:util'

import { GitHubRemoteNotConfiguredError, GithubUrlError, GitRepositoryNotFoundError } from './errors.js'

const execAsync = promisify(exec)

export class GitService {
  private static WIN_REPO_CMD = 'git rev-parse --git-dir > nul 2>&1'
  private static UNIX_REPO_CMD = 'git rev-parse --git-dir > /dev/null 2>&1'

  constructor() {}

  public async isGitRepo(): Promise<boolean> {
    try {
      const command = process.platform === 'win32' ? GitService.WIN_REPO_CMD : GitService.UNIX_REPO_CMD
      await execAsync(command)
      return true
    } catch {
      throw GitRepositoryNotFoundError()
    }
  }

  public async getRemoteUrl(): Promise<string> {
    const { stdout } = await execAsync('git remote get-url origin')
    const remoteUrl = stdout.trim()
    if (!remoteUrl) throw GitHubRemoteNotConfiguredError()
    return remoteUrl
  }

  /**
   * Extract GitHub repo from git remote URL
   * Supports various formats:
   * - git@github.com:user/repo.git -> user/repo
   * - https://github.com/user/repo.git -> user/repo
   * - https://github.com/user/repo -> user/repo
   */
  public async getGithubRepo(): Promise<string> {
    const remoteUrl = await this.getRemoteUrl()

    const match = remoteUrl.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/)
    if (!match) throw GithubUrlError(remoteUrl)

    const repo = match[1].replace(/\.git$/, '').trim()
    if (!repo) throw GithubUrlError(repo)

    return repo
  }
}
