#!/usr/bin/env node

import { fileURLToPath } from 'node:url'
import cfonts from 'cfonts'
import express from 'express'
import open from 'open'
import path from 'path'
import serveStatic from 'serve-static'

const app = express()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const args = process.argv.slice(2)

async function main() {
  const port = parseInt(process.env.PORT || '3000')

  app.use(
    serveStatic(path.join(__dirname, './client'), {
      index: ['index.html'],
    }),
  )
  app.listen(port)

  if (args.includes('--open')) {
    open(`http://localhost:${port}`)
  }

  cfonts.say(`Pipe UI`, {
    font: 'simple3d',
  })
  console.log('--------------------------------------------------------')
  console.log(' ')
  console.log(`🚀  Server started at http://localhost:${port}`)
}

main()
