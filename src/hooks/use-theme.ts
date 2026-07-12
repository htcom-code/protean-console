import { useEffect, useState } from 'react'
import { readStored, writeStored } from '@/hooks/use-persistent-state'

type Theme = 'light' | 'dark'

const THEME_KEY = 'pc:theme'

function prefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

/**
 * Persisted light/dark theme. The choice is stored under `pc:theme` and is the
 * source of truth; the inline bootstrap in index.html applies it to <html>
 * before first paint (no flash), and this hook keeps React + storage in sync.
 * Falls back to the OS preference when nothing is stored yet.
 */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(
    () => readStored<Theme | null>(THEME_KEY, null) ?? (prefersDark() ? 'dark' : 'light'),
  )

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    writeStored(THEME_KEY, theme)
  }, [theme])

  return {
    theme,
    toggle: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')),
  }
}
