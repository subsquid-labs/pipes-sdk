import { describe, expect, it } from 'vitest'

import { validateProjectFolder } from './validate-project-folder.js'

describe('validateProjectFolder', () => {
  it('accepts a simple folder name', () => {
    expect(validateProjectFolder('my-project')).toBe(true)
  })

  it('accepts a nested relative path', () => {
    expect(validateProjectFolder('path/to/my-project')).toBe(true)
  })

  it('rejects an empty string', () => {
    expect(validateProjectFolder('')).toBe('Project folder cannot be empty')
  })

  it('rejects whitespace-only input', () => {
    expect(validateProjectFolder('   ')).toBe('Project folder cannot be empty')
  })

  it.each([['<'], ['>'], ['"'], ['|'], ['?'], ['*']])('rejects names containing invalid character %s', (char) => {
    const result = validateProjectFolder(`foo${char}bar`)
    expect(result).toContain('invalid characters')
  })

  it.each([['CON'], ['PRN'], ['AUX'], ['NUL'], ['COM1'], ['LPT9']])('rejects reserved Windows name %s', (name) => {
    const result = validateProjectFolder(name)
    expect(result).toContain('reserved')
  })

  it('accepts names that only contain a reserved-like substring', () => {
    expect(validateProjectFolder('my-CON-project')).toBe(true)
  })
})
