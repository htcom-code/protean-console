import { useCallback, useEffect, useState } from 'react'

// All console-owned localStorage keys share the `pc:` prefix so they're easy to
// spot and clear as a group. Callers pass the full key, e.g. 'pc:theme'.

/** Read + JSON-parse a persisted value, tolerating private-mode / parse errors. */
export function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw == null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}

/** JSON-serialize + persist a value, silently ignoring storage failures. */
export function writeStored<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage full / disabled — non-fatal, state still lives in memory */
  }
}

/**
 * `useState` that mirrors its value to localStorage under `key` (JSON-encoded).
 * Initial value comes from storage when present, else `initial`. Writes are
 * best-effort (private mode / quota failures are swallowed).
 */
export function usePersistentState<T>(key: string, initial: T): [T, (v: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => readStored(key, initial))

  useEffect(() => {
    writeStored(key, value)
  }, [key, value])

  const set = useCallback((v: T | ((prev: T) => T)) => {
    setValue((prev) => (typeof v === 'function' ? (v as (p: T) => T)(prev) : v))
  }, [])

  return [value, set]
}
