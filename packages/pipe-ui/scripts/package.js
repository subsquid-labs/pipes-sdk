import { fileURLToPath } from 'node:url'
import fs from 'fs'
import path from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json')).toString('utf8'))

pkg.dependencies = {
  'serve-static': '2.2.0',
  express: '5.1.0',
  cfonts: '2.4.8',
  open: '10.2.0',
}
delete pkg.devDependencies
delete pkg.scripts

pkg.files = ['client', 'package.json', 'bin.js']

fs.writeFileSync(path.join(__dirname, '../build/package.json'), JSON.stringify(pkg, null, 2))
fs.copyFileSync(path.join(__dirname, './bin.js'), path.join(__dirname, '../build/bin.js'))
