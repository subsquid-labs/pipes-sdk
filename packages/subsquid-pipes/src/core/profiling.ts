// TODO we need to implement labels
// When we expose that span to UI, we need to filter them out by label

import { arrayify } from '../internal/array.js'

export type ProfilerOptions = { id: string } | null

/**
 * Lifecycle hooks for a single profiler span.
 * Implement this interface to bridge spans to any tracing backend (OTEL, Datadog, Zipkin, …).
 *
 * When a child span starts, `onStart(name)` is called and must return hooks for that child.
 * When this span ends, `onEnd()` is called.
 */
export interface SpanHooks {
  onStart(name: string): SpanHooks
  onEnd(): void
}

export interface Profiler {
  name: string
  elapsed: number
  children: Profiler[]
  data?: any

  start(name: string): Profiler
  measure<T>(name: string, fn: (span: Profiler) => Promise<T>): Promise<T>
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

  readonly #hooks: SpanHooks | null

  /**
   * Creates a root Profiler span.
   *
   * - `enabled = false`     → returns a no-op DummyProfiler
   * - `enabled = true`      → creates a plain Span (no external tracing)
   * - `enabled = SpanHooks` → creates a Span wired to the provided hooks;
   *                           use `otelProfilerHooks()` to export to Jaeger / any OTEL backend
   */
  static root(name: string, enabled: boolean | SpanHooks): Profiler {
    if (enabled === false) return new DummyProfiler()

    const hooks = enabled === true ? null : enabled.onStart(name)
    return new Span(name, hooks)
  }

  private constructor(
    public name: string,
    hooks: SpanHooks | null,
  ) {
    this.started = performance.now()
    this.#hooks = hooks
  }

  start(name: string) {
    const childHooks = this.#hooks?.onStart(name) ?? null
    const child = new Span(name, childHooks)
    this.children.push(child)
    return child
  }

  addLabels(labels: string | string[]) {
    this.labels.push(...arrayify(labels))
    return this
  }

  async measure<T = any>(name: string, fn: (span: Profiler) => Promise<T>): Promise<T> {
    const span = this.start(name)
    const res = await fn(span)
    span.end()

    return res
  }

  addTransformerExemplar(data: any) {
    this.data = packExemplar(data)
    return this
  }

  /**
   Marks the end of the span and calculates the elapsed time.

   Returns the current span instance for chaining.
   */
  end() {
    this.elapsed = performance.now() - this.started
    this.#hooks?.onEnd()

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

  async measure<T>(name: string, fn: (span: Profiler) => Promise<T>): Promise<T> {
    return fn(this)
  }

  addTransformerExemplar() {
    return this
  }

  transform<T>(transformer: (span: Span, level: number) => T, level: number = 0): T[] {
    return []
  }
}
