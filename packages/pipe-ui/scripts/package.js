import { fileURLToPath } from 'node:url'
import fs from 'fs'
import path from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json')).toString('utf8'))

pkg.dependencies = {
  next: pkg.dependencies.next,
  react: pkg.dependencies.react,
  'react-dom': pkg.dependencies['react-dom'],
  'js-yaml': pkg.dependencies['js-yaml'],
  cfonts: '2.4.8',
  open: '10.2.0',
}
delete pkg.devDependencies
delete pkg.scripts

pkg.files = ['.next', 'public', 'config.yaml', 'package.json', 'bin.js', 'next.config.ts']

fs.writeFileSync(path.join(__dirname, '../dist/package.json'), JSON.stringify(pkg, null, 2))
fs.copyFileSync(path.join(__dirname, './bin.js'), path.join(__dirname, '../dist/bin.js'))
fs.copyFileSync(path.join(__dirname, '../config.yaml'), path.join(__dirname, '../dist/config.yaml'))
