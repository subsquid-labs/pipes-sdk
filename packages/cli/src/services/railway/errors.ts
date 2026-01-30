import chalk from 'chalk'

export const RailwayNotLoggedInError = () =>
  new Error(`${chalk.bold('Not logged in to Railway')}

${chalk.gray('You need to be logged in to Railway to deploy. To continue:')}

${chalk.yellow('  1.')} Log in to Railway: ${chalk.cyan('railway login')}
${chalk.yellow('  2.')} Run the deploy command again
`)
