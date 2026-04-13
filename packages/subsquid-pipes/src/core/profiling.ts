// TODO we need to implement labels
// When we expose that span to UI, we need to filter them out by label

import { arrayify } from '../internal/array.js'

export type ProfilerOptions = { id: string; hidden?: boolean }

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
  id: string
  elapsed: number
  hidden: boolean
  children: Profiler[]
  data?: any

  start(options?: string | ProfilerOptions): Profiler
  measure<T>(name: string | ProfilerOptions, fn: (span: Profiler) => Promise<T>): Promise<T>
  measureSync<T>(name: string | ProfilerOptions, fn: (span: Profiler) => T): T
  addLabels(labels: string | string[]): Profiler
  end(): Profiler
  flatten<T>(transformer: (span: Span, level: number) => T, level?: number): T[]
  /**
   * Recursively transforms the span tree into a new tree structure.
   * Hidden spans are skipped — their children are promoted to the parent level.
   */
  transform<T>(fn: (span: Profiler, children: T[]) => T): T
}

export class Span implements Profiler {
  id: string
  children: Span[] = []
  elapsed = 0
  started = 0
  labels: string[] = []
  data?: any

  readonly hidden: boolean
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
    return new Span({ id: name, hooks })
  }

  private constructor(opts: {
    id: string
    hooks?: SpanHooks | null
    hidden?: boolean
  }) {
    this.id = opts.id
    this.started = performance.now()
    this.hidden = opts.hidden ?? false
    this.#hooks = opts.hooks ?? null
  }

  start(options?: string | ProfilerOptions) {
    if (typeof options === 'string') {
      options = { id: options }
    } else if (!options) {
      options = { id: 'anonymous' }
    }

    if (options.hidden) {
      const child = new Span({
        id: options.id,
        hooks: this.#hooks,
        hidden: true,
      })
      this.children.push(child)

      return child
    }

    const child = new Span({
      id: options.id,
      hooks: this.#hooks?.onStart(options.id) ?? null,
    })
    this.children.push(child)

    return child
  }

  addLabels(labels: string | string[]) {
    this.labels.push(...arrayify(labels))
    return this
  }

  async measure<T = any>(name: string | ProfilerOptions, fn: (span: Profiler) => Promise<T>): Promise<T> {
    const span = this.start(typeof name === 'string' ? { id: name } : name)
    const res = await fn(span)
    span.end()

    return res
  }

  measureSync<T = any>(name: string | ProfilerOptions, fn: (span: Profiler) => T): T {
    const span = this.start(typeof name === 'string' ? { id: name } : name)
    const res = fn(span)
    span.end()

    return res
  }

  /**
   Marks the end of the span and calculates the elapsed time.

   Returns the current span instance for chaining.
   */
  end() {
    this.elapsed = performance.now() - this.started
    if (!this.hidden) {
      this.#hooks?.onEnd()
    }

    return this
  }

  flatten<T>(transformer: (span: Span, level: number) => T, level = 0): T[] {
    if (this.hidden) {
      return this.children.flatMap((child) => child.flatten(transformer, level))
    }
    return [transformer(this, level), ...this.children.flatMap((child) => child.flatten(transformer, level + 1))]
  }

  transform<T>(fn: (span: Profiler, children: T[]) => T): T {
    return fn(this, this.#transformChildren(fn))
  }

  #transformChildren<T>(fn: (span: Profiler, children: T[]) => T): T[] {
    return this.children.flatMap((child) => {
      if (child.hidden) {
        return child.#transformChildren(fn)
      }
      return [child.transform(fn)]
    })
  }

  toString() {
    return this.flatten((s, level) => `${''.padEnd(level, ' ')}[${s.id}] ${s.elapsed.toFixed(2)}ms`).join('\n')
  }
}

export class DummyProfiler implements Profiler {
  id: string = ''
  elapsed: number = 0
  hidden: boolean = false
  children: DummyProfiler[] = []

  start(options?: string | ProfilerOptions) {
    return this
  }

  addLabels(labels: string | string[]) {
    return this
  }

  end() {
    return this
  }

  async measure<T>(name: string | ProfilerOptions, fn: (span: Profiler) => Promise<T>): Promise<T> {
    return fn(this)
  }

  measureSync<T>(name: string | ProfilerOptions, fn: (span: Profiler) => T): T {
    return fn(this)
  }

  flatten<T>(transformer: (span: Span, level: number) => T, level: number = 0): T[] {
    return []
  }

  transform<T>(fn: (span: Profiler, children: T[]) => T): T {
    return fn(this, [])
  }
}
