import chalk from 'chalk'

export const GitRepositoryNotFoundError = () =>
  new Error(`${chalk.bold('Git repository not found')}

${chalk.gray('Railway deploys from your Git repository. To continue:')}

${chalk.yellow('  1.')} Initialize a Git repository: ${chalk.cyan('git init')}
${chalk.yellow('  2.')} Push your code to GitHub (connected to your Railway account)
${chalk.yellow('  3.')} Run the deploy command again
`)

export const GitHubRemoteNotConfiguredError = () =>
  new Error(`${chalk.bold('GitHub remote not configured')}

${chalk.gray('Railway needs a GitHub remote to deploy your code. To continue:')}

${chalk.yellow('  1.')} Create a new GitHub repository: ${chalk.cyan.underline('https://github.com/new')}
${chalk.yellow('  2.')} Set GitHub remote: ${chalk.cyan('git remote add origin <url>')}
${chalk.yellow('  3.')} Add & commit your changes ${chalk.cyan('git add . && git commit -m "<commit-message>"')}
${chalk.yellow('  4.')} Push your code to GitHub ${chalk.cyan('git push origin main')}
${chalk.yellow('  5.')} Run the deploy command again
`)

export const GithubUrlError = (remoteUrl: string) => {
  throw new Error(`Could not extract GitHub repo from remote URL: ${remoteUrl}`)
}
