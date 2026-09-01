import { useCallback, useState } from 'react'
import { loadSettings, saveSettings, type Settings } from '@/lib/settings'

/**
 * User settings, read from localStorage once and written back on save.
 *
 * Loaded lazily so a blocked or hand-edited store cannot break the first render —
 * `loadSettings` validates every field and falls back to its default.
 */
export function useSettings(): { settings: Settings; save: (next: Settings) => void } {
  const [settings, setSettings] = useState<Settings>(() => loadSettings())
  const save = useCallback((next: Settings) => {
    saveSettings(next)
    setSettings(next)
  }, [])
  return { settings, save }
}
