'use client'

import { useCallback } from 'react'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'

type ParamType = string | number | boolean

// Widen literal types inferred from `defaultValue` (e.g. `'profiler'` → `string`)
// so consumers get a mutable API: `setTab('query')` rather than `setTab('profiler')` only.
type Widen<T> = T extends string
  ? string
  : T extends number
    ? number
    : T extends boolean
      ? boolean
      : T

type Options<T extends ParamType> = {
  /** If the parsed value fails validation, the default is returned. */
  validate?: (value: T) => boolean
}

/**
 * Syncs a single URL query param with React state.
 * - Reads via `useSearchParams` (no `window`, SSR-safe).
 * - Writes via `router.replace` with `scroll: false` — no history entry, no scroll jump.
 * - Omits the param from the URL when the value equals `defaultValue` to keep URLs clean.
 * - Booleans are serialized as `1` / `0` when written (so a non-default `false` can be preserved).
 *
 * Must be used under a Suspense boundary (Next.js requirement for `useSearchParams`).
 */
export function useUrlParam<T extends ParamType>(
  key: string,
  defaultValue: T,
  options: Options<Widen<T>> = {},
): [Widen<T>, (value: Widen<T>) => void] {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const raw = searchParams.get(key)
  const value = parseValue(raw, defaultValue as Widen<T>, options.validate)

  const setValue = useCallback(
    (next: Widen<T>) => {
      const params = new URLSearchParams(searchParams.toString())
      if (next === defaultValue) {
        params.delete(key)
      } else {
        params.set(key, serializeValue(next))
      }
      const query = params.toString()
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
    },
    [defaultValue, key, pathname, router, searchParams],
  )

  return [value, setValue]
}

function parseValue<T extends ParamType>(
  raw: string | null,
  defaultValue: T,
  validate?: (value: T) => boolean,
): T {
  if (raw === null) return defaultValue

  let parsed: ParamType
  if (typeof defaultValue === 'number') {
    const n = Number(raw)
    parsed = Number.isFinite(n) ? n : defaultValue
  } else if (typeof defaultValue === 'boolean') {
    parsed = raw === '1' || raw === 'true'
  } else {
    parsed = raw
  }

  if (validate && !validate(parsed as T)) return defaultValue
  return parsed as T
}

function serializeValue(value: ParamType): string {
  if (typeof value === 'boolean') return value ? '1' : '0'
  return String(value)
}
