import { type WriteStream, createWriteStream } from 'node:fs'
import { open as fsOpen, stat } from 'node:fs/promises'

/**
 * Opens a writable file stream and resolves once its fd is actually open (or rejects on an open
 * error), mirroring `@dsnp/parquetjs`'s internal `osopen`. Owning the stream — instead of letting
 * `ParquetWriter.openFile` create it internally — lets the caller `destroy()` it to force the fd
 * shut if `ParquetWriter.close()` fails or hangs mid-footer (the library otherwise leaks it).
 */
export function openWriteStream(p: string): Promise<WriteStream> {
  return new Promise((resolve, reject) => {
    const stream = createWriteStream(p)
    const onOpen = () => {
      stream.off('error', onError)
      resolve(stream)
    }
    const onError = (err: Error) => {
      stream.off('open', onOpen)
      reject(err)
    }
    stream.once('open', onOpen)
    stream.once('error', onError)
  })
}

/** Whether a path exists (any type). */
export async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

/** fsync a file by path: open `r+`, sync, close. */
export async function fsyncFile(p: string): Promise<void> {
  const fh = await fsOpen(p, 'r+')
  try {
    await fh.sync()
  } finally {
    await fh.close()
  }
}

/**
 * fsync a directory so a contained `rename`/create survives a crash. Node has no path-based dir
 * fsync, so open the directory and fsync the returned fd. Best-effort: some platforms (notably
 * Windows) reject fsync on a directory handle — the atomic rename already gives crash-consistent
 * visibility on POSIX, so a failure here is non-fatal.
 */
export async function fsyncDir(dir: string): Promise<void> {
  let fh: Awaited<ReturnType<typeof fsOpen>> | undefined
  try {
    fh = await fsOpen(dir, 'r')
    await fh.sync()
  } catch {
    // best-effort
  } finally {
    await fh?.close()
  }
}
