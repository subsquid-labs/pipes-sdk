'use client'

import { useCallback, useEffect, useState } from 'react'

export function useLocalStorage<T>(key: string, defaultValue: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === 'undefined') return defaultValue

    try {
      const stored = localStorage.getItem(key)
      return stored !== null ? (JSON.parse(stored) as T) : defaultValue
    } catch {
      return defaultValue
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      // ignore write errors (quota, privacy mode, etc.)
    }
  }, [key, value])

  const set = useCallback((next: T) => setValue(next), [])

  return [value, set]
}
