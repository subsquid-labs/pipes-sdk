'use client'

import { useCallback } from 'react'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'

type ParamType = string | number | boolean

// Widen literal types inferred from `defaultValue` (e.g. `'profiler'` → `string`)
// so consumers get a mutable API: `setTab('query')` rather than `setTab('profiler')` only.
type Widen<T> = T extends string ? string : T extends number ? number : T extends boolean ? boolean : T

type Options<T extends ParamType> = {
  /** If the parsed value fails validation, the default is returned. */
  validate?: (value: T) => boolean
}

type ParamMetadata = {
  raw: string | null
  isValid: boolean
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
): [Widen<T>, (value: Widen<T>) => void, ParamMetadata] {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const raw = searchParams.get(key)
  const { value, isValid } = parseValue(raw, defaultValue as Widen<T>, options.validate)

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

  return [value, setValue, { raw, isValid }]
}

type UrlUpdates = Record<string, string | number | null>

/**
 * Applies several query-param changes as one atomic history operation —
 * sequential `useUrlParam` setters would clobber each other because each
 * snapshots `searchParams` before writing.
 * `null` removes a param; `push: true` creates a history entry (default replaces).
 */
export function useUrlNavigate() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  return useCallback(
    (updates: UrlUpdates, { push = false }: { push?: boolean } = {}) => {
      const params = new URLSearchParams(searchParams.toString())
      for (const [key, value] of Object.entries(updates)) {
        if (value === null) params.delete(key)
        else params.set(key, String(value))
      }

      const query = params.toString()
      const url = query ? `${pathname}?${query}` : pathname

      if (push) router.push(url, { scroll: false })
      else router.replace(url, { scroll: false })
    },
    [pathname, router, searchParams],
  )
}

function parseValue<T extends ParamType>(
  raw: string | null,
  defaultValue: T,
  validate?: (value: T) => boolean,
): { value: T; isValid: boolean } {
  if (raw === null) return { value: defaultValue, isValid: true }

  let parsed: ParamType
  if (typeof defaultValue === 'number') {
    if (raw.trim() === '') return { value: defaultValue, isValid: false }

    const n = Number(raw)
    if (!Number.isFinite(n)) return { value: defaultValue, isValid: false }
    parsed = n
  } else if (typeof defaultValue === 'boolean') {
    // Only accept explicit truthy/falsy tokens; fall back to default for anything else.
    if (raw === '1' || raw === 'true') parsed = true
    else if (raw === '0' || raw === 'false') parsed = false
    else return { value: defaultValue, isValid: false }
  } else {
    parsed = raw
  }

  if (validate && !validate(parsed as T)) return { value: defaultValue, isValid: false }
  return { value: parsed as T, isValid: true }
}

function serializeValue(value: ParamType): string {
  if (typeof value === 'boolean') return value ? '1' : '0'
  return String(value)
}
