import { useCallback, useEffect, useRef, useState } from 'react'

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
 * Call `onChange` when another tab changes one of `keys`.
 *
 * Every `pc:` key is shared by all tabs of the console, but each tab read it once at
 * mount and never again — so a tab kept acting on a value the user had already
 * changed elsewhere. For most keys that only looks stale; for retention it is two
 * tabs pruning one IndexedDB to two different limits.
 *
 * The browser fires `storage` only in the *other* tabs, and only when a value
 * actually changes, so writing a value back on receipt cannot echo. A `null` key is
 * `localStorage.clear()`, which changed every key at once.
 */
export function subscribeStored(keys: readonly string[], onChange: () => void): () => void {
  let area: Storage
  try {
    area = window.localStorage
  } catch {
    return () => {} // storage blocked — no other tab can be writing to it either
  }
  const handler = (e: StorageEvent) => {
    if (e.storageArea !== area) return
    if (e.key === null || keys.includes(e.key)) onChange()
  }
  window.addEventListener('storage', handler)
  return () => window.removeEventListener('storage', handler)
}

/**
 * `useState` that mirrors its value to localStorage under `key` (JSON-encoded).
 * Initial value comes from storage when present, else `initial`. Writes are
 * best-effort (private mode / quota failures are swallowed). A change made in
 * another tab is picked up as it happens.
 */
export function usePersistentState<T>(key: string, initial: T): [T, (v: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => readStored(key, initial))

  useEffect(() => {
    writeStored(key, value)
  }, [key, value])

  // Read by the listener below, which must not be re-subscribed on every render.
  const initialRef = useRef(initial)
  useEffect(() => {
    initialRef.current = initial
  })

  useEffect(() => subscribeStored([key], () => setValue(readStored(key, initialRef.current))), [key])

  const set = useCallback((v: T | ((prev: T) => T)) => {
    setValue((prev) => (typeof v === 'function' ? (v as (p: T) => T)(prev) : v))
  }, [])

  return [value, set]
}
