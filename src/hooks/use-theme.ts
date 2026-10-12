import { useEffect, useState } from 'react'
import { readStored, usePersistentState } from '@/hooks/use-persistent-state'

type Theme = 'light' | 'dark'

const THEME_KEY = 'pc:theme'

function prefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

/**
 * Persisted light/dark theme. The choice is stored under `pc:theme` and is the
 * source of truth; the inline bootstrap in index.html applies it to <html>
 * before first paint (no flash), and this hook keeps React + storage in sync —
 * including a toggle made in another tab. Falls back to the OS preference when
 * nothing is stored yet.
 */
export function useTheme() {
  // Resolved once, and the OS is asked only when nothing is stored — as before. If
  // another tab removes the key, this tab keeps the theme it started with.
  const [fallback] = useState<Theme>(() => readStored<Theme | null>(THEME_KEY, null) ?? (prefersDark() ? 'dark' : 'light'))
  const [theme, setTheme] = usePersistentState<Theme>(THEME_KEY, fallback)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])

  return {
    theme,
    toggle: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')),
  }
}
