import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SettingsDialog } from '@/components/settings-dialog'
import { DEFAULT_SETTINGS, RETENTION_MIN, loadSettings, saveSettings, type Settings } from '@/lib/settings'

/**
 * The settings dialog, driven the way a person drives it.
 *
 * These assertions exist because the logic underneath is already covered and the
 * screen was not: `settings.test.ts` proves `validate()` rejects 49,999, but nothing
 * proved the dialog *shows* that rejection, refuses to save it, or leaves storage
 * alone when the user cancels. Those are the failures that reach the operator — a
 * Save button that accepts a below-floor limit writes a number the pruner then
 * enforces, and a Cancel that saves anyway silently changes what gets deleted.
 *
 * The dialog is rendered with the real `loadSettings`/`saveSettings` pair behind it,
 * so what these tests assert is what a reload would read back.
 */

const KEYS = ['pc:retention', 'pc:evictionFactor', 'pc:pageSize', 'pc:sampleDelayMs']

/** The dialog as `TopBar` wires it: open state outside, persistence on save. */
function Harness({ initial = DEFAULT_SETTINGS }: { initial?: Settings }) {
  const [settings, setSettings] = useState(initial)
  const [open, setOpen] = useState(true)
  return (
    <>
      <button onClick={() => setOpen(true)}>reopen</button>
      <SettingsDialog
        open={open}
        onOpenChange={setOpen}
        settings={settings}
        onSave={(next) => {
          setSettings(next)
          saveSettings(next)
        }}
      />
    </>
  )
}

const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement
const button = (name: string) => screen.getByRole('button', { name })

/**
 * Replace a number field's whole value.
 *
 * `fireEvent.change` rather than `user-event`, deliberately: it needs no new
 * dependency and it drives the same `onChange` the browser fires, which is the path
 * verified by hand against the running console.
 */
function retype(label: string, value: string) {
  fireEvent.change(field(label), { target: { value } })
}

const click = (name: string) => fireEvent.click(button(name))

beforeEach(() => {
  for (const k of KEYS) window.localStorage.removeItem(k)
})

afterEach(() => {
  // Explicit: this suite runs without vitest `globals`, so Testing Library never
  // registers its auto-cleanup. Without this the previous test's dialog stays in the
  // document (it renders through a portal) and every query finds two of everything.
  cleanup()
  for (const k of KEYS) window.localStorage.removeItem(k)
})

describe('a limit the console cannot honour', () => {
  it('says why, and will not let it be saved', async () => {
    render(<Harness />)

    retype('Retention limit', '100')

    // 🔴 The reason is on screen, not only in a return value. A disabled button with
    // no stated cause reads as a broken dialog.
    expect(await screen.findByText(/at least 50,000/)).toBeTruthy()
    expect(field('Retention limit').getAttribute('aria-invalid')).toBe('true')
    expect((button('Save') as HTMLButtonElement).disabled).toBe(true)

    // And nothing was written on the way.
    expect(window.localStorage.getItem('pc:retention')).toBeNull()
  })

  it('accepts the floor itself — the boundary is inclusive on screen too', async () => {
    render(<Harness />)

    retype('Retention limit', String(RETENTION_MIN))
    await waitFor(() => expect((button('Save') as HTMLButtonElement).disabled).toBe(false))

    click('Save')
    await waitFor(() => expect(loadSettings().retention).toBe(RETENTION_MIN))
  })

  it('blocks the save while any one field is bad, not just the one being typed', async () => {
    render(<Harness />)

    retype('Load-older page size', '0')
    await waitFor(() => expect((button('Save') as HTMLButtonElement).disabled).toBe(true))

    // A valid retention does not rescue an invalid page size.
    retype('Retention limit', '90000')
    expect((button('Save') as HTMLButtonElement).disabled).toBe(true)

    retype('Load-older page size', '50')
    await waitFor(() => expect((button('Save') as HTMLButtonElement).disabled).toBe(false))
  })

  it('treats an emptied field as unusable rather than as zero', async () => {
    // `Number('')` is 0, which would pass a naive bounds check on some fields and
    // silently store it. The draft is kept as text precisely so this stays visible.
    render(<Harness />)

    retype('Sample-data delay', '')
    await waitFor(() => expect((button('Save') as HTMLButtonElement).disabled).toBe(true))
    expect(field('Sample-data delay').getAttribute('aria-invalid')).toBe('true')
  })
})

describe('saving', () => {
  it('persists every field where a reload will find it', async () => {
    render(<Harness />)

    retype('Retention limit', '80000')
    retype('Load-older page size', '25')
    retype('Sample-data delay', '1200')
    fireEvent.click(screen.getByRole('button', { name: '4×' }))
    click('Save')

    await waitFor(() =>
      expect(loadSettings()).toEqual({
        retention: 80_000,
        evictionFactor: 4,
        pageSize: 25,
        sampleDelayMs: 1_200,
      }),
    )
  })

  it('closes the dialog', async () => {
    render(<Harness />)
    click('Save')
    await waitFor(() => expect(screen.queryByText('Settings')).toBeNull())
  })

  it('keeps one factor selected — clicking the live one again does not clear it', async () => {
    // Base UI's toggle group hands back an empty array on deselect. There is no
    // "no eviction factor", so that has to be absorbed rather than stored.
    render(<Harness />)

    fireEvent.click(screen.getByRole('button', { name: '2×' }))
    fireEvent.click(screen.getByRole('button', { name: '2×' }))
    click('Save')

    await waitFor(() => expect(loadSettings().evictionFactor).toBe(2))
  })
})

describe('cancelling', () => {
  it('leaves storage exactly as it was', async () => {
    const stored: Settings = { retention: 70_000, evictionFactor: 8, pageSize: 10, sampleDelayMs: 900 }
    saveSettings(stored)

    render(<Harness initial={stored} />)

    retype('Retention limit', '999000')
    click('Cancel')

    // 🔴 Nothing was written. A Cancel that persists silently changes what the
    // pruner deletes, and the user believes they backed out.
    await waitFor(() => expect(screen.queryByText('Settings')).toBeNull())
    expect(loadSettings()).toEqual(stored)
  })

  it('discards the abandoned draft — reopening shows what is stored', async () => {
    const stored: Settings = { ...DEFAULT_SETTINGS, retention: 60_000 }
    saveSettings(stored)

    render(<Harness initial={stored} />)

    retype('Retention limit', '123456')
    click('Cancel')
    await waitFor(() => expect(screen.queryByText('Settings')).toBeNull())

    click('reopen')
    await waitFor(() => expect(field('Retention limit').value).toBe('60000'))
  })
})

describe('reset to defaults', () => {
  it('fills the form without saving anything by itself', async () => {
    const stored: Settings = { retention: 70_000, evictionFactor: 8, pageSize: 10, sampleDelayMs: 900 }
    saveSettings(stored)

    render(<Harness initial={stored} />)

    click('Reset to defaults')
    await waitFor(() => expect(field('Retention limit').value).toBe(String(DEFAULT_SETTINGS.retention)))

    // It is a form action, not a save action — storage is untouched until Save.
    expect(loadSettings()).toEqual(stored)

    click('Save')
    await waitFor(() => expect(loadSettings()).toEqual(DEFAULT_SETTINGS))
  })
})

describe('what the eviction factor says it will do', () => {
  it('describes evicting the overflow at 1×, and a multiple above it', async () => {
    // The wording is the only place the user learns that a higher factor keeps
    // *fewer* rows than the limit they just typed. Silence there makes the limit a
    // false promise.
    render(<Harness />)

    expect(screen.getByText(/Removes only the overflow/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '8×' }))
    await waitFor(() => expect(screen.getByText(/Removes 8× the incoming batch/)).toBeTruthy())
    expect(screen.getByText(/fewer rows than the limit/)).toBeTruthy()
  })

  it('marks the live factor as pressed, and only it', async () => {
    render(<Harness />)

    const pressed = () =>
      ['1×', '2×', '4×', '8×'].filter((label) => {
        const el = screen.getByRole('button', { name: label })
        const v = el.getAttribute('data-pressed') ?? el.getAttribute('aria-pressed')
        return v !== null && v !== 'false'
      })

    expect(pressed()).toEqual(['1×'])
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '4×' }))
    })
    await waitFor(() => expect(pressed()).toEqual(['4×']))
  })
})
