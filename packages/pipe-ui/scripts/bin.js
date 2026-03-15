#!/usr/bin/env node

import { execSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import cfonts from 'cfonts'
import open from 'open'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

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

  execSync(`node ${path.join(__dirname, 'server.js')}`, {
    stdio: 'inherit',
    env: { ...process.env, PORT: String(port), HOSTNAME: '0.0.0.0' },
  })
}

main()
