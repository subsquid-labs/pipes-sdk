import crypto from 'node:crypto'

export function generatePipeId(): string {
  return crypto.randomBytes(4).toString('hex')
}
