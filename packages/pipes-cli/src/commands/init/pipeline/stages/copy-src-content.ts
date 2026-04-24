import { existsSync } from 'node:fs'
import path from 'node:path'

import { getTemplateDirname } from '~/utils/fs.js'
import { toKebabCase } from '~/utils/string.js'

import type { InitStage } from '../types.js'

export const copySrcContentStage: InitStage = {
  id: 'copy-src-content',
  label: 'Copying template contracts',
  run: async (ctx) => {
    for (const { template } of ctx.config.templates) {
      if (!template.copySrc) continue
      const subpath = typeof template.copySrc === 'string' ? template.copySrc : 'src'
      const srcDir = path.join(getTemplateDirname(ctx.config.networkType), toKebabCase(template.id), subpath)
      if (existsSync(srcDir)) {
        ctx.projectWriter.copyFile(srcDir, 'src')
      }
    }
  },
}
