/** Checks if the current Node.js version is at least the specified version. */
export function isNodeVersionGreaterOrEqual(major: number, minor = 0, patch = 0) {
  if (!process || !process.versions || !process.versions.node) {
    return false
  }

  const [M, m, p] = process.versions.node.split('.').map(Number)

  return M > major || (M === major && m > minor) || (M === major && m === minor && p >= patch)
}
