import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { usePersistentState } from '@/hooks/use-persistent-state'
import { useSettings } from '@/hooks/use-settings'
import { useTheme } from '@/hooks/use-theme'
import { DEFAULT_SETTINGS, RETENTION_MIN } from '@/lib/settings'

/**
 * Every `pc:` key is shared by all tabs of the console, and each tab used to read it
 * once at mount. Lowering retention in one tab left another pruning the same
 * IndexedDB to the old limit until it was reloaded — the tab with the higher limit
 * counting rows the other had already evicted.
 *
 * The browser tells the other tabs through a `storage` event, fired only in tabs
 * other than the writer. These scenarios play that tab: write the key the way
 * another tab would, then deliver the event the browser would deliver.
 */
function otherTab(key: string | null, value?: unknown, area: Storage = window.localStorage): void {
  act(() => {
    if (key === null) area.clear()
    else area.setItem(key, JSON.stringify(value))
    window.dispatchEvent(
      new StorageEvent('storage', { key, newValue: key === null ? null : JSON.stringify(value), storageArea: area }),
    )
  })
}

beforeEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
  document.documentElement.classList.remove('dark')
})

describe('settings changed in another tab', () => {
  it('reach this tab without a reload', () => {
    const { result } = renderHook(() => useSettings())
    expect(result.current.settings.retention).toBe(RETENTION_MIN)

    otherTab('pc:retention', 200_000)

    expect(result.current.settings.retention).toBe(200_000)
  })

  it('are validated on the way in, like a value read at mount', () => {
    // Another tab is just another writer to storage; what it wrote is not trusted
    // any more than a hand-edited entry.
    const { result } = renderHook(() => useSettings())
    otherTab('pc:retention', 5)
    expect(result.current.settings.retention).toBe(DEFAULT_SETTINGS.retention)
  })

  it('arrive whole, one key per event', () => {
    // A save writes four keys; this tab may see the events before every write has
    // landed. Each event re-reads everything, so the last one leaves the full set.
    const { result } = renderHook(() => useSettings())
    otherTab('pc:retention', 80_000)
    otherTab('pc:evictionFactor', 4)
    otherTab('pc:pageSize', 500)
    otherTab('pc:sampleDelayMs', 9_000)
    expect(result.current.settings).toEqual({ retention: 80_000, evictionFactor: 4, pageSize: 500, sampleDelayMs: 9_000 })
  })

  it('leave the settings object alone when nothing changed', () => {
    // Consumers key effects on `settings`; a new identity for the same values would
    // restart them (the stream's fallback timer among them) for no reason.
    const { result } = renderHook(() => useSettings())
    const before = result.current.settings
    otherTab('pc:theme', 'dark')
    otherTab('pc:retention', RETENTION_MIN) // written, but to the value already held
    expect(result.current.settings).toBe(before)
  })

  it('go back to defaults when another tab clears storage', () => {
    window.localStorage.setItem('pc:retention', JSON.stringify(90_000))
    const { result } = renderHook(() => useSettings())
    expect(result.current.settings.retention).toBe(90_000)

    otherTab(null)

    expect(result.current.settings).toEqual(DEFAULT_SETTINGS)
  })

  it('ignore the same key in sessionStorage', () => {
    const { result } = renderHook(() => useSettings())
    otherTab('pc:retention', 200_000, window.sessionStorage)
    expect(result.current.settings.retention).toBe(RETENTION_MIN)
  })
})

describe('preferences changed in another tab', () => {
  it('reach a persistent state hook', () => {
    const { result } = renderHook(() => usePersistentState('pc:metricsSort', 'name'))
    otherTab('pc:metricsSort', 'p95')
    expect(result.current[0]).toBe('p95')
  })

  it('switch the theme, class and all', () => {
    window.localStorage.setItem('pc:theme', JSON.stringify('light'))
    const { result } = renderHook(() => useTheme())
    expect(result.current.theme).toBe('light')

    otherTab('pc:theme', 'dark')

    expect(result.current.theme).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('stop arriving once the hook unmounts', () => {
    const { result, unmount } = renderHook(() => usePersistentState('pc:metricsSort', 'name'))
    unmount()
    otherTab('pc:metricsSort', 'p95')
    expect(result.current[0]).toBe('name')
  })
})
