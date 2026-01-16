/** Checks if the current Node.js version is at least the specified version. */
export function isNodeVersionGreaterOrEqual(major: number, minor = 0, patch = 0) {
  if (!process || !process.versions || !process.versions.node) {
    return false
  }

  const [M, m, p] = process.versions.node.split('.').map(Number)

  if (M !== major) return M >= major
  if (m !== minor) return m >= minor
  return p >= patch
}
