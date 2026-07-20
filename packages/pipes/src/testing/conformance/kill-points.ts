import { mkdir, rm } from 'node:fs/promises'

/**
 * Kill-point injection (FM-30…FM-34).
 *
 * A crash is injected by obstructing the filesystem rather than by mocking it: a directory is
 * placed where the sink is about to write a file, so the syscall fails the way it would against a
 * full or failing disk, and the run dies at exactly that step of the commit protocol.
 *
 * The reason it is done this way rather than with `vi.mock('node:fs/promises')` is that this
 * project runs every suite in a single fork with `isolate: false`, so a module another file has
 * already imported keeps its real binding and never sees the mock. Obstruction is independent of
 * pool configuration and of module-registry state.
 *
 * Fidelity limit, stated plainly: the process is not actually dead, so unwinding still runs and the
 * sink still gets to discard its open segment. What the obstruction reproduces faithfully is the
 * *on-disk state at the moment the run stops* — which is the thing recovery has to reconcile, and
 * the thing the CT-2 matrix is about. Recovery deletes every `.tmp-*` unconditionally anyway, so
 * the surviving difference does not change what recovery must do.
 */

export type Obstruction = {
  readonly path: string
  /** Removes the obstruction so a restart can proceed. */
  release(): Promise<void>
}

/**
 * Makes `target` unwritable by occupying it with a directory. Creating or renaming onto it fails
 * with EISDIR/ENOTEMPTY rather than silently overwriting.
 */
export async function obstruct(target: string): Promise<Obstruction> {
  await mkdir(target, { recursive: true })

  return {
    path: target,
    release: () => rm(target, { recursive: true, force: true }),
  }
}

/** Width `<min>-<max>.parquet` names are padded to (IB-22). */
const BLOCK_PAD = 12

/** Path of the unit a class-K sink publishes for `[from, to]`. */
export function unitPath(dir: string, table: string, from: number, to: number): string {
  const pad = (block: number) => Math.trunc(block).toString().padStart(BLOCK_PAD, '0')

  return `${dir}/${table}/${pad(from)}-${pad(to)}.parquet`
}

/** Path of the durable state record, namespaced by pipe id when one is set (IB-22). */
export function statePath(dir: string, id?: string): string {
  return `${dir}/${id ? `_sqd_parquet_state.${id}.json` : '_sqd_parquet_state.json'}`
}

/**
 * Runs `fn` expecting it to die, and returns the error. Fails loudly when the run survives — a
 * matrix point that quietly stops firing would otherwise keep passing forever.
 */
export async function expectCrash(fn: () => Promise<unknown>): Promise<Error> {
  try {
    await fn()
  } catch (error) {
    return error as Error
  }

  throw new Error('expected the run to be interrupted, but it completed')
}
