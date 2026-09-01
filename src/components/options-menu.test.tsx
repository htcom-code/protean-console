import { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TopBar } from '@/components/top-bar'
import { ALL_HEALTHY } from '@/hooks/use-console-data'
import { STORAGE_OK } from '@/hooks/use-trace-store'
import { useSettings } from '@/hooks/use-settings'
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '@/lib/settings'

/**
 * The options button that replaced the theme toggle.
 *
 * Replacing a one-click control with a menu is where a shortcut quietly disappears:
 * the theme toggle used to be one press and is now two, and if the menu item were
 * mis-wired the theme would simply stop working with nothing on screen to say so.
 * These assertions pin both paths — the menu opens, and each item does the thing its
 * label promises.
 *
 * `TopBar` is rendered whole rather than the menu in isolation, because the defect
 * this guards against lives in the wiring: the dialog's open state and the settings
 * props are held by `TopBar`, not by the menu.
 */

const KEYS = ['pc:retention', 'pc:evictionFactor', 'pc:pageSize', 'pc:sampleDelayMs']

/**
 * `App`'s composition of the header — including the real `useSettings`, so a save
 * goes through the same persistence the app uses. A harness that only held settings
 * in state would have passed while the app wrote nothing (measured: it did).
 */
function Harness() {
  // Fixed, not `Date.now()`: the header only needs a live-looking connection, and an
  // impure call during render is exactly what this project's lint rule forbids.
  const [connectedAt] = useState(() => Date.now())
  const [theme, setTheme] = useState<'light' | 'dark'>('dark')
  const { settings, save } = useSettings()
  const [streaming, setStreaming] = useState(true)
  return (
    <TopBar
      streaming={streaming}
      onToggleStream={() => setStreaming((s) => !s)}
      theme={theme}
      onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
      conn={{ status: 'live', lastUpdated: connectedAt }}
      channels={ALL_HEALTHY}
      storage={STORAGE_OK}
      settings={settings}
      onSaveSettings={save}
    />
  )
}

const openMenu = () => fireEvent.click(screen.getByRole('button', { name: 'Options' }))
const item = (name: RegExp) => screen.getByRole('menuitem', { name })

beforeEach(() => {
  for (const k of KEYS) window.localStorage.removeItem(k)
})

afterEach(() => {
  // No vitest `globals`, so Testing Library registers no auto-cleanup; the menu and
  // dialog render through portals and would survive into the next test.
  cleanup()
  for (const k of KEYS) window.localStorage.removeItem(k)
})

describe('the options button', () => {
  it('is the only control in the theme toggle’s old slot', async () => {
    render(<Harness />)

    expect(screen.getByRole('button', { name: 'Options' })).toBeTruthy()

    // 🔴 The old direct toggle is gone — if both existed the header would have two
    // ways to do one thing, which is the state this change was meant to remove.
    expect(screen.queryByRole('button', { name: /Switch to (light|dark) theme/ })).toBeNull()

    // Nothing from the menu is on screen until it is opened.
    expect(screen.queryByRole('menuitem')).toBeNull()
  })

  it('opens a menu with exactly the two items', async () => {
    render(<Harness />)
    openMenu()

    await waitFor(() => expect(screen.getAllByRole('menuitem')).toHaveLength(2))
    expect(item(/Theme/)).toBeTruthy()
    expect(item(/Settings/)).toBeTruthy()
  })

  it('says which theme is live, so the menu is readable without pressing it', async () => {
    render(<Harness />)
    openMenu()

    await waitFor(() => expect(item(/Theme/).textContent).toContain('dark'))
  })
})

describe('the Theme item', () => {
  it('still toggles the theme — the shortcut survived the move into a menu', async () => {
    render(<Harness />)

    openMenu()
    await waitFor(() => expect(item(/Theme/)).toBeTruthy())
    fireEvent.click(item(/Theme/))

    // Reopening reads the new value back out of the same label.
    await waitFor(() => expect(screen.queryByRole('menuitem')).toBeNull())
    openMenu()
    await waitFor(() => expect(item(/Theme/).textContent).toContain('light'))
  })

  it('closes the menu, rather than leaving it open over the console', async () => {
    render(<Harness />)
    openMenu()
    await waitFor(() => expect(item(/Theme/)).toBeTruthy())
    fireEvent.click(item(/Theme/))
    await waitFor(() => expect(screen.queryByRole('menuitem')).toBeNull())
  })
})

describe('the Settings item', () => {
  it('opens the settings dialog on the stored values', async () => {
    saveSettings({ ...DEFAULT_SETTINGS, retention: 75_000 })
    render(<Harness />)

    openMenu()
    await waitFor(() => expect(item(/Settings/)).toBeTruthy())
    fireEvent.click(item(/Settings/))

    const input = await waitFor(() => screen.getByLabelText('Retention limit') as HTMLInputElement)
    expect(input.value).toBe('75000')
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy()
  })

  it('carries a save all the way through to storage', async () => {
    // The whole path a user takes: button → menu → dialog → edit → Save. Each hop is
    // a place the props could be dropped, and the hooks tests cannot see any of them.
    render(<Harness />)

    openMenu()
    await waitFor(() => expect(item(/Settings/)).toBeTruthy())
    fireEvent.click(item(/Settings/))
    await waitFor(() => expect(screen.getByLabelText('Retention limit')).toBeTruthy())

    fireEvent.change(screen.getByLabelText('Retention limit'), { target: { value: '65000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(loadSettings().retention).toBe(65_000))
  })

  it('reopens on what was saved, not on the last draft', async () => {
    render(<Harness />)

    openMenu()
    await waitFor(() => expect(item(/Settings/)).toBeTruthy())
    fireEvent.click(item(/Settings/))
    await waitFor(() => expect(screen.getByLabelText('Retention limit')).toBeTruthy())
    fireEvent.change(screen.getByLabelText('Retention limit'), { target: { value: '999000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByLabelText('Retention limit')).toBeNull())

    openMenu()
    await waitFor(() => expect(item(/Settings/)).toBeTruthy())
    fireEvent.click(item(/Settings/))
    const input = await waitFor(() => screen.getByLabelText('Retention limit') as HTMLInputElement)
    expect(input.value).toBe(String(DEFAULT_SETTINGS.retention))
  })
})
