import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ProjectAlreadyExistError } from '../../init.errors.js'
import { makeTestContext } from '../testing/make-context.js'
import { checkProjectPathStage } from './check-project-path.js'

describe('checkProjectPathStage', () => {
  let tmpRoot: string

  beforeEach(async () => {
    tmpRoot = await mkdtemp(path.join(tmpdir(), 'check-path-'))
  })

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true })
  })

  it('passes when the project directory does not exist', async () => {
    const { ctx } = makeTestContext({ projectFolder: path.join(tmpRoot, 'missing-project') })

    await expect(checkProjectPathStage.run(ctx)).resolves.toBeUndefined()
  })

  it('throws ProjectAlreadyExistError when the project directory exists', async () => {
    const { ctx } = makeTestContext({ projectFolder: tmpRoot })

    await expect(checkProjectPathStage.run(ctx)).rejects.toBeInstanceOf(ProjectAlreadyExistError)
  })

  it('allows an existing directory when regenerating', async () => {
    const { ctx } = makeTestContext({ projectFolder: tmpRoot, regenerate: true })

    await expect(checkProjectPathStage.run(ctx)).resolves.toBeUndefined()
  })
})
