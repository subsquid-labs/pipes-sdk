#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const packageJsonPath = path.resolve(__dirname, '..', 'package.json');
const backupPath = `${packageJsonPath}.prepack-backup`;
const workspaceRoot = path.resolve(__dirname, '..', '..', '..');
const packagesDir = path.join(workspaceRoot, 'packages');

if (fs.existsSync(backupPath)) {
  fs.copyFileSync(backupPath, packageJsonPath);
  fs.unlinkSync(backupPath);
}

const workspaceVersions = new Map();
for (const entry of fs.readdirSync(packagesDir)) {
  const subPkgPath = path.join(packagesDir, entry, 'package.json');
  if (!fs.existsSync(subPkgPath)) continue;
  const subPkg = JSON.parse(fs.readFileSync(subPkgPath, 'utf8'));
  if (subPkg.name && subPkg.version) {
    workspaceVersions.set(subPkg.name, subPkg.version);
  }
}

const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const depFields = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
const rewrites = [];

for (const field of depFields) {
  const deps = pkg[field];
  if (!deps) continue;
  for (const [name, range] of Object.entries(deps)) {
    if (typeof range !== 'string' || !range.startsWith('workspace:')) continue;
    const version = workspaceVersions.get(name);
    if (!version) {
      console.error(`[prepack] cannot resolve workspace version for "${name}"`);
      process.exit(1);
    }
    deps[name] = version;
    rewrites.push(`${field}.${name}: ${range} -> ${version}`);
  }
}

if (rewrites.length === 0) {
  process.exit(0);
}

fs.copyFileSync(packageJsonPath, backupPath);
fs.writeFileSync(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`);
for (const line of rewrites) console.log(`[prepack] ${line}`);
