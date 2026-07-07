/**
 * UTF-8 encode a JS string to ArrayBuffer.
 * @internal
 */
export function stringToArrayBuffer(str: string): Uint8Array {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(str)
  }

  throw new Error(
    'TextEncoder is not supported in this environment. Please ensure you are running in a modern JavaScript environment that supports TextEncoder (Node.js 11+, modern browsers, or include a polyfill).',
  )
}

/**
 * Returns a hex-encoded SHA-256 hash of the input string.
 * @internal
 */
export async function sha256Hex(data: string): Promise<string> {
  // globalThis.crypto is available in browsers, Node 18+, and Cloudflare Workers
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error(
      'crypto.subtle is not supported in this environment. Please ensure you are running in a modern JavaScript environment that supports crypto.subtle (Node.js 18+, modern browsers, or include a polyfill).',
    )
  }
  const d = await crypto.subtle.digest('SHA-256', stringToArrayBuffer(data))
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
