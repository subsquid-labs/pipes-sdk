// TODO we need to implement labels
// When we expose that span to UI, we need to filter them out by label

import { arrayify } from '../internal/array.js'

export type ProfilerOptions = { id: string } | null

export interface Profiler {
  name: string
  elapsed: number
  children: Profiler[]

  start(name: string): Profiler
  addLabels(labels: string | string[]): Profiler
  end(): Profiler
  transform<T>(transformer: (span: Span, level: number) => T, level?: number): T[]
}

export class Span implements Profiler {
  children: Span[] = []
  elapsed = 0
  started = 0
  labels: string[] = []

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
  transform<T>(transformer: (span: Span, level: number) => T, level: number = 0): T[] {
    return []
  }
}
