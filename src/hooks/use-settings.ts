import { useCallback, useEffect, useState } from 'react'
import { subscribeStored } from '@/hooks/use-persistent-state'
import { loadSettings, sameSettings, saveSettings, SETTINGS_KEYS, type Settings } from '@/lib/settings'

/**
 * User settings, read from localStorage and written back on save.
 *
 * Loaded lazily so a blocked or hand-edited store cannot break the first render —
 * `loadSettings` validates every field and falls back to its default.
 *
 * A save in another tab is picked up as it happens. Read once at mount, two tabs
 * holding different retention limits pruned the same IndexedDB to both: the tab
 * with the higher limit kept counting rows the other had already evicted. The new
 * value takes effect from the next decision that reads it — the trace store reads
 * its settings when it evicts, so an eviction already under way finishes on the
 * limit it started with and the next batch uses the new one.
 */
export function useSettings(): { settings: Settings; save: (next: Settings) => void } {
  const [settings, setSettings] = useState<Settings>(() => loadSettings())
  const save = useCallback((next: Settings) => {
    saveSettings(next)
    setSettings(next)
  }, [])

  useEffect(
    () =>
      subscribeStored(SETTINGS_KEYS, () => {
        // A save writes four keys and arrives here as up to four events. Each reloads
        // all four, so the tab converges on the last; one that changes nothing keeps
        // the old identity, or every consumer keyed on `settings` would run again.
        const next = loadSettings()
        setSettings((prev) => (sameSettings(prev, next) ? prev : next))
      }),
    [],
  )

  return { settings, save }
}
