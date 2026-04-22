import path from 'node:path'

export function deriveProjectName(projectFolder: string): string {
  return path.basename(path.resolve(projectFolder))
}
