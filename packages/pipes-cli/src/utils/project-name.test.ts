import { describe, expect, it } from 'vitest'

import { deriveProjectName } from './project-name.js'

describe('deriveProjectName', () => {
  it('returns the last path segment of a POSIX path', () => {
    expect(deriveProjectName('/home/user/projects/my-pipe')).toBe('my-pipe')
  })

  it('ignores trailing slashes', () => {
    expect(deriveProjectName('./my-pipe/')).toBe('my-pipe')
  })

  it('returns the bare folder name for a relative single-segment path', () => {
    expect(deriveProjectName('my-pipe')).toBe('my-pipe')
  })
})
