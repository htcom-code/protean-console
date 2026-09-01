// A real IndexedDB implementation, in-memory. The trace store's behaviour is
// mostly *what ends up persisted*, so stubbing the store out would test nothing.
import 'fake-indexeddb/auto'

/**
 * A working `localStorage`.
 *
 * jsdom 30 as vitest constructs it defines the `localStorage` getter on `window`
 * but never creates the object behind it, so every `localStorage.getItem` in the
 * app throws — and since `readStored`/`writeStored` swallow storage errors by
 * design (private mode, blocked site data), settings silently read back as
 * defaults no matter what a test wrote. Nothing failed; the assertions were just
 * never exercising storage. Measured, not assumed: `typeof window.localStorage`
 * is `"undefined"` while `_localStorage` sits on the window as an own property.
 *
 * Faithful to the real thing in what the console depends on: string keys and
 * string values, `null` for a missing key, per-file isolation (each test file gets
 * its own module instance and therefore its own map).
 */
class MemoryStorage implements Storage {
  #map = new Map<string, string>()
  get length() {
    return this.#map.size
  }
  key(i: number) {
    return [...this.#map.keys()][i] ?? null
  }
  getItem(k: string) {
    return this.#map.get(String(k)) ?? null
  }
  setItem(k: string, v: string) {
    this.#map.set(String(k), String(v))
  }
  removeItem(k: string) {
    this.#map.delete(String(k))
  }
  clear() {
    this.#map.clear()
  }
}

for (const name of ['localStorage', 'sessionStorage'] as const) {
  if (window[name] == null) {
    Object.defineProperty(window, name, { value: new MemoryStorage(), configurable: true })
  }
}
