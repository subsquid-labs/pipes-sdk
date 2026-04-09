import { describe, expect, it } from 'vitest'

import { Span } from './profiling.js'

describe('Span', () => {
  it('applies labels passed via ProfilerOptions to the new child span', () => {
    const root = Span.root('root', true)

    const child = root.start({ name: 'child', labels: ['core', 'db'] })
    child.end()

    expect(child.labels).toEqual(['core', 'db'])
  })

  it('accepts a single string label', () => {
    const root = Span.root('root', true)

    const child = root.start({ name: 'child', labels: 'db' })
    child.end()

    expect(child.labels).toEqual(['db'])
  })

  it('does not propagate parent labels to child spans', () => {
    const root = Span.root('root', true).addLabels('core')

    const child = root.start({ name: 'child' })
    child.end()

    expect(root.labels).toEqual(['core'])
    expect(child.labels).toEqual([])
  })

  it('forwards labels through measure()', async () => {
    const root = Span.root('root', true)

    let captured: string[] = []
    await root.measure({ name: 'child', labels: 'db' }, async (span) => {
      captured = [...span.labels]
    })

    expect(captured).toEqual(['db'])
  })

  it('applies labels to hidden spans as well', () => {
    const root = Span.root('root', true)

    const child = root.start({ name: 'child', hidden: true, labels: 'core' })
    child.end()

    expect(child.labels).toEqual(['core'])
    expect(child.hidden).toBe(true)
  })

  it('ends the span when measure() callback throws', async () => {
    const root = Span.root('root', true)

    let captured: { elapsed: number } | null = null
    await expect(
      root.measure('child', async (span) => {
        captured = span as { elapsed: number }
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')

    expect(captured).not.toBeNull()
    // span.end() sets elapsed > 0
    expect((captured as unknown as { elapsed: number }).elapsed).toBeGreaterThanOrEqual(0)
    expect(root.children).toHaveLength(1)
    expect(root.children[0].name).toBe('child')
  })

  it('ends the span when measureSync() callback throws', () => {
    const root = Span.root('root', true)

    let captured: { elapsed: number } | null = null
    expect(() =>
      root.measureSync('child', (span) => {
        captured = span as { elapsed: number }
        throw new Error('boom')
      }),
    ).toThrow('boom')

    expect(captured).not.toBeNull()
    expect((captured as unknown as { elapsed: number }).elapsed).toBeGreaterThanOrEqual(0)
  })

  it('invokes SpanHooks.onEnd when measure() callback throws', async () => {
    const ended: string[] = []
    const hooks = {
      onStart(name: string) {
        return {
          onStart: hooks.onStart,
          onEnd() {
            ended.push(name)
          },
        }
      },
      onEnd() {},
    }
    const root = Span.root('root', hooks)

    await expect(
      root.measure('child', async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')

    expect(ended).toContain('child')
  })
})
