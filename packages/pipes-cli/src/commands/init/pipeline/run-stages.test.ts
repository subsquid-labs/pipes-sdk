import * as fsPromises from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { InitPipelineError } from './errors.js'
import { runStages } from './run-stages.js'
import type { InitContext, InitStage } from './types.js'

const { mkdtemp, stat, writeFile } = fsPromises

async function pathExists(p: string) {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

function makeContext(overrides: Partial<InitContext> = {}): InitContext {
  return {
    config: { projectFolder: '/tmp/x' } as InitContext['config'],
    projectName: 'x',
    projectPath: '/tmp/x',
    projectWriter: {} as InitContext['projectWriter'],
    ...overrides,
  }
}

describe('runStages', () => {
  let tmpRoot: string
  let projectPath: string

  beforeEach(async () => {
    tmpRoot = await mkdtemp(path.join(tmpdir(), 'run-stages-'))
    projectPath = path.join(tmpRoot, 'project')
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await fsPromises.rm(tmpRoot, { recursive: true, force: true })
  })

  it('runs stages in order and passes the context to each', async () => {
    const calls: string[] = []
    const seenContexts: InitContext[] = []
    const stages: InitStage[] = [
      {
        id: 'first',
        label: 'First',
        run: async (ctx) => {
          calls.push('first')
          seenContexts.push(ctx)
        },
      },
      {
        id: 'second',
        label: 'Second',
        run: async (ctx) => {
          calls.push('second')
          seenContexts.push(ctx)
        },
      },
    ]
    const ctx = makeContext()

    await runStages(stages, ctx)

    expect(calls).toEqual(['first', 'second'])
    expect(seenContexts).toEqual([ctx, ctx])
  })

  it('updates spinner text to each stage label before running the stage', async () => {
    const spinner = { text: 'initial' }
    const observedTexts: string[] = []
    const stages: InitStage[] = [
      {
        id: 'first',
        label: 'Writing static files',
        run: async () => {
          observedTexts.push(spinner.text)
        },
      },
      {
        id: 'second',
        label: 'Installing dependencies',
        run: async () => {
          observedTexts.push(spinner.text)
        },
      },
    ]

    await runStages(stages, makeContext(), { spinner })

    expect(observedTexts).toEqual(['Writing static files', 'Installing dependencies'])
  })

  it('collects an optional stage failure, keeps going, and does not clean up', async () => {
    await fsPromises.mkdir(projectPath, { recursive: true })
    await writeFile(path.join(projectPath, 'file.txt'), 'hello')

    const boom = new Error('install failed')
    const ranAfter: string[] = []
    const cleanup = vi.fn(async () => {})
    const stages: InitStage[] = [
      { id: 'check-project-path', label: 'Check', run: async () => {} },
      {
        id: 'install-dependencies',
        label: 'Installing dependencies',
        optional: true,
        run: async () => {
          throw boom
        },
      },
      {
        id: 'write-index',
        label: 'Write index',
        run: async () => {
          ranAfter.push('write-index')
        },
      },
    ]

    const failures = await runStages(stages, makeContext({ projectPath }), { cleanup })

    expect(failures).toEqual([{ stageId: 'install-dependencies', label: 'Installing dependencies', error: boom }])
    // The pipeline continued past the optional failure...
    expect(ranAfter).toEqual(['write-index'])
    // ...and the project was preserved (no cleanup).
    expect(cleanup).not.toHaveBeenCalled()
    await expect(pathExists(projectPath)).resolves.toBe(true)
  })

  it('returns an empty failure list when every stage succeeds', async () => {
    const stages: InitStage[] = [
      { id: 'a', label: 'A', run: async () => {} },
      { id: 'b', label: 'B', optional: true, run: async () => {} },
    ]

    await expect(runStages(stages, makeContext())).resolves.toEqual([])
  })

  it('wraps stage failures in InitPipelineError with stageId and cause', async () => {
    const original = new Error('boom')
    const stages: InitStage[] = [
      {
        id: 'check-project-path',
        label: 'Check path',
        run: async () => {
          throw original
        },
      },
    ]

    await expect(runStages(stages, makeContext())).rejects.toMatchObject({
      name: 'InitPipelineError',
      stageId: 'check-project-path',
      cause: original,
    })
    await expect(runStages(stages, makeContext())).rejects.toBeInstanceOf(InitPipelineError)
  })

  it('deletes the project directory when a stage after check-project-path fails', async () => {
    await fsPromises.mkdir(projectPath, { recursive: true })
    await writeFile(path.join(projectPath, 'file.txt'), 'hello')

    const stages: InitStage[] = [
      { id: 'check-project-path', label: 'Check', run: async () => {} },
      {
        id: 'write-static-files',
        label: 'Write static',
        run: async () => {
          throw new Error('disk full')
        },
      },
    ]

    await expect(runStages(stages, makeContext({ projectPath }))).rejects.toBeInstanceOf(InitPipelineError)
    await expect(pathExists(projectPath)).resolves.toBe(false)
  })

  it('does not delete a pre-existing project when regenerating fails', async () => {
    await fsPromises.mkdir(projectPath, { recursive: true })
    await writeFile(path.join(projectPath, 'file.txt'), 'hello')

    const stages: InitStage[] = [
      { id: 'check-project-path', label: 'Check', run: async () => {} },
      {
        id: 'write-static-files',
        label: 'Write static',
        run: async () => {
          throw new Error('disk full')
        },
      },
    ]

    await expect(runStages(stages, makeContext({ projectPath, regenerate: true }))).rejects.toBeInstanceOf(
      InitPipelineError,
    )
    // The folder predated the run, so it must survive the failure.
    await expect(pathExists(projectPath)).resolves.toBe(true)
  })

  it('surfaces the original pipeline error even when cleanup fails', async () => {
    const original = new Error('stage boom')
    const cleanup = vi.fn(async () => {
      throw new Error('rm failed')
    })
    const stages: InitStage[] = [
      { id: 'check-project-path', label: 'Check', run: async () => {} },
      {
        id: 'write-static-files',
        label: 'Write static',
        run: async () => {
          throw original
        },
      },
    ]

    await expect(runStages(stages, makeContext({ projectPath }), { cleanup })).rejects.toMatchObject({
      name: 'InitPipelineError',
      stageId: 'write-static-files',
      cause: original,
    })
    expect(cleanup).toHaveBeenCalledWith(projectPath)
  })

  it.each([
    ['empty string', ''],
    ['filesystem root', '/'],
    ['home directory', homedir()],
  ])('refuses to delete unsafe path: %s', async (_label, unsafePath) => {
    const stages: InitStage[] = [
      { id: 'check-project-path', label: 'Check', run: async () => {} },
      {
        id: 'write-static-files',
        label: 'Write static',
        run: async () => {
          throw new Error('boom')
        },
      },
    ]

    await expect(runStages(stages, makeContext({ projectPath: unsafePath }))).rejects.toBeInstanceOf(InitPipelineError)
    if (unsafePath) {
      await expect(pathExists(unsafePath)).resolves.toBe(true)
    }
  })
})
