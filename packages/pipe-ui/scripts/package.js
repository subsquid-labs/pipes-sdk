import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const root = path.join(__dirname, '..')
const dist = path.join(root, 'dist')
const standalone = path.join(root, '.next/standalone')

fs.rmSync(dist, { recursive: true, force: true })
fs.mkdirSync(dist, { recursive: true })

// In a monorepo, standalone nests files under the package path
const standaloneApp = path.join(standalone, path.relative(path.join(root, '../..'), root))

// Copy standalone server and .next build output
fs.copyFileSync(path.join(standaloneApp, 'server.js'), path.join(dist, 'server.js'))
if (fs.existsSync(path.join(standaloneApp, '.next'))) {
  fs.cpSync(path.join(standaloneApp, '.next'), path.join(dist, '.next'), { recursive: true })
}

// Copy static assets and public files (not included in standalone by default)
fs.cpSync(path.join(root, '.next/static'), path.join(dist, '.next/static'), { recursive: true })
fs.cpSync(path.join(root, 'public'), path.join(dist, 'public'), { recursive: true })

const configPath = path.join(root, 'config.yaml')
if (fs.existsSync(configPath)) {
  fs.copyFileSync(configPath, path.join(dist, 'config.yaml'))
}

fs.copyFileSync(path.join(__dirname, 'bin.js'), path.join(dist, 'bin.js'))

// Prepare package.json for publishing
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json')).toString('utf8'))

pkg.bin = { 'pipe-ui': './bin.js' }
pkg.dependencies = {
  'js-yaml': pkg.dependencies['js-yaml'],
  cfonts: '2.4.8',
  open: '10.2.0',
}
delete pkg.devDependencies
delete pkg.scripts

pkg.files = ['.next', 'public', 'config.yaml', 'package.json', 'bin.js', 'server.js', 'node_modules']

fs.writeFileSync(path.join(dist, 'package.json'), JSON.stringify(pkg, null, 2))
