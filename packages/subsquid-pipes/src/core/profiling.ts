// TODO we need to implement labels
// When we expose that span to UI, we need to filter them out by label

import { arrayify } from '../internal/array.js'

export type ProfilerOptions = { id: string } | null

export interface Profiler {
  name: string
  elapsed: number
  children: Profiler[]
  data?: any

  start(name: string): Profiler
  addLabels(labels: string | string[]): Profiler
  end(): Profiler
  addTransformerExemplar(dataExample: any): Profiler
  transform<T>(transformer: (span: Span, level: number) => T, level?: number): T[]
}

function packExemplar(value: any): any {
  if (Array.isArray(value)) {
    if (
      value.length <= 10 &&
      !value.some((v) => typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean')
    ) {
      return value
    }

    if (value.length > 10) {
      return [packExemplar(value[0]), `... ${value.length - 1} more ...`]
    }

    return value.map(packExemplar)
  }

  if (value === null || value instanceof Date) return value

  if (typeof value === 'object') {
    const res: any = {}
    for (const key in value) {
      res[key] = packExemplar(value[key])
    }
    return res
  }

  return value
}

export class Span implements Profiler {
  children: Span[] = []
  elapsed = 0
  started = 0
  labels: string[] = []
  data?: any

  static root(name: string, enabled: boolean): Profiler {
    if (!enabled) return new DummyProfiler()

    return new Span(name)
  }

  private constructor(public name: string) {
    this.started = performance.now()
  }

  start(name: string) {
    const child = new Span(name)
    this.children.push(child)
    return child
  }

  addLabels(labels: string | string[]) {
    this.labels.push(...arrayify(labels))
    return this
  }

  addTransformerExemplar(data: any) {
    this.data = packExemplar(data)
    return this
  }

  /**
   Marks the end of the span and calculates the elapsed time.
   Optionally accepts a snapshot object that can store how the span changed the state.

   Returns the current span instance for chaining.
   */
  end() {
    this.elapsed = performance.now() - this.started

    return this
  }

  transform<T>(transformer: (span: Span, level: number) => T, level = 0): T[] {
    return [transformer(this, level), ...this.children.flatMap((child) => child.transform(transformer, level + 1))]
  }

  toString() {
    return this.transform((s, level) => `${''.padEnd(level, ' ')}[${s.name}] ${s.elapsed.toFixed(2)}ms`).join('\n')
  }
}

export class DummyProfiler implements Profiler {
  name: string = ''
  elapsed: number = 0
  children: DummyProfiler[] = []

  start(name: string | null) {
    return this
  }
  addLabels(labels: string | string[]) {
    return this
  }
  end() {
    return this
  }

  addTransformerExemplar() {
    return this
  }

  transform<T>(transformer: (span: Span, level: number) => T, level: number = 0): T[] {
    return []
  }
}
