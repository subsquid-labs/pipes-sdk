#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const packageJsonPath = path.resolve(__dirname, '..', 'package.json');
const backupPath = `${packageJsonPath}.prepack-backup`;

if (fs.existsSync(backupPath)) {
  fs.copyFileSync(backupPath, packageJsonPath);
  fs.unlinkSync(backupPath);
  console.log('[postpack] restored package.json');
}
