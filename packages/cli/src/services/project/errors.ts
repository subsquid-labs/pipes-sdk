import chalk from 'chalk'

export const PackageJsonNotFoundError = () =>
  new Error(`${chalk.bold('package.json not found')}

${chalk.gray('Pipes CLI extracts the name from package.json to use as the Railway project name.')}
${chalk.gray('Unable to find package.json in the root directory.')}

${chalk.yellow('  1.')} Ensure you're running the deploy command from the project root directory
${chalk.yellow('  2.')} Make sure ${chalk.cyan('package.json')} exists in the root directory
${chalk.yellow('  3.')} Run the deploy command again
`)

export const PackageNameNotFoundError = () =>
  new Error(`${chalk.bold('Package name not found in package.json')}

${chalk.gray('Railway needs a package name to deploy your project. To continue:')}

${chalk.yellow('  1.')} Add a ${chalk.cyan('"name"')} field to your ${chalk.cyan('package.json')}
${chalk.yellow('  2.')} Run the deploy command again
`)
