#!/usr/bin/env node

import { execSync } from 'node:child_process'
import cfonts from 'cfonts'
import open from 'open'

const args = process.argv.slice(2)

async function main() {
  const port = parseInt(process.env.PORT || '3000')

  cfonts.say(`Pipe UI`, {
    font: 'simple3d',
  })
  console.log('--------------------------------------------------------')
  console.log(' ')
  console.log(`🚀  Starting server at http://localhost:${port}`)

  if (args.includes('--open')) {
    setTimeout(() => open(`http://localhost:${port}`), 2000)
  }

  execSync(`npx next start -p ${port}`, { stdio: 'inherit' })
}

main()
