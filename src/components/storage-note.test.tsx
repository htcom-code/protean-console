import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TraceTable } from '@/components/trace-table'
import * as db from '@/lib/trace-db'
import { DEFAULT_SETTINGS } from '@/lib/settings'
import { useConsoleUnderTest } from '@/test/console-driver'
import { GO_CONNECT, FIXTURE_NEWEST_EPOCH, traceFrame } from '@/test/stream-fixtures'
import { FakeEventSource, installFakeEventSource, replay } from '@/test/sse-stream'

/**
 * Whether a storage failure actually reaches the screen.
 *
 * `storage-failure.test.ts` proves the store *records* a refused read, write, or
 * delete. That is one hop short of the thing that matters: the operator learns about
 * it only if the table renders it. A `StorageHealth` field nobody paints is exactly
 * as silent as the swallowed exception it replaced — and the wiring between the two
 * (`storageReason(store.storage)` inside `TraceTable`) had no test at all.
 *
 * So these scenarios run the real hooks against a real IndexedDB, break one
 * operation at its boundary, and then read the rendered DOM. Each failure has to say
 * a *different* thing, because each one is a different lie about what is on screen.
 */
vi.mock('@/lib/trace-db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/trace-db')>()
  return {
    ...actual,
    upsertTraces: vi.fn(actual.upsertTraces),
    getTracePage: vi.fn(actual.getTracePage),
    clearTraces: vi.fn(actual.clearTraces),
  }
})

const quota = () => new DOMException('The quota has been exceeded.', 'QuotaExceededError')
const denied = () => new DOMException('The operation is insecure.', 'SecurityError')

/** `App`'s composition, down to the table that has to speak. */
function Harness() {
  const { store } = useConsoleUnderTest(DEFAULT_SETTINGS)
  return <TraceTable store={store} />
}

/**
 * The counts the table's own header claims: `N shown · M retained`.
 *
 * Not a row count — the table body is virtualized, so in jsdom (zero-height
 * container) it paints no rows at all and counting `tbody tr` would compare 0 to 0
 * and pass vacuously. Measured: it did. The header chip is the number the operator
 * reads anyway, which makes it the honest thing to assert.
 */
function counts(container: HTMLElement): { shown: number; retained: number } {
  const m = /([\d,]+) shown · ([\d,]+) retained/.exec(container.textContent ?? '')
  if (!m) throw new Error('the table did not state its counts')
  return { shown: Number(m[1].replace(/,/g, '')), retained: Number(m[2].replace(/,/g, '')) }
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
  })
}

/** Connect and deliver the fixture dump, so the table has rows to qualify. */
async function connected() {
  const view = render(<Harness />)
  await act(async () => {
    const es = FakeEventSource.current()
    es.emit('open')
    replay(es, GO_CONNECT)
  })
  await settle()
  return view
}

let restoreEventSource: () => void

beforeEach(async () => {
  restoreEventSource = installFakeEventSource()
  vi.mocked(db.upsertTraces).mockReset()
  vi.mocked(db.getTracePage).mockReset()
  vi.mocked(db.clearTraces).mockReset()
  await db.clearTraces()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  restoreEventSource()
})

describe('a refused write', () => {
  it('tells the operator the rows on screen are not in storage yet', async () => {
    vi.mocked(db.upsertTraces).mockRejectedValueOnce(quota())
    const view = await connected()

    const note = await screen.findByText(/not saving to browser storage/)
    // The `DOMException.name` verbatim — `QuotaExceededError` is what tells the
    // operator to clear history. Turning it into prose would invent a cause.
    expect(note.textContent).toContain('QuotaExceededError')
    expect(note.textContent).toContain('not in storage yet')

    // The rows are still listed. Hiding them would be a second, worse lie.
    // And `retained` is 0, which is exactly why the note has to qualify them.
    expect(counts(view.container).shown).toBeGreaterThan(0)
    expect(counts(view.container).retained).toBe(0)
  })

  it('takes the message down once a write succeeds', async () => {
    vi.mocked(db.upsertTraces).mockRejectedValueOnce(quota())
    await connected()
    await screen.findByText(/not saving to browser storage/)

    await act(async () => {
      FakeEventSource.current().emit('trace', traceFrame(9101, FIXTURE_NEWEST_EPOCH + 1_000))
    })

    // 🔴 A note with no exit reads as a permanent fault. This is the half the
    // hook tests can assert on state but not on screen.
    await waitFor(() => expect(screen.queryByText(/not saving to browser storage/)).toBeNull())
  })
})

describe('a refused read', () => {
  it('does not let an unreadable history look like an empty one', async () => {
    vi.mocked(db.getTracePage).mockRejectedValueOnce(denied())
    await connected()

    const note = await screen.findByText(/saved history could not be read/)
    expect(note.textContent).toContain('SecurityError')
    expect(note.textContent).toContain('missing rows that are still stored')
  })
})

describe('a refused delete', () => {
  it('says the history was NOT deleted, and keeps the rows visible', async () => {
    const view = await connected()
    await waitFor(async () => expect(await db.countTraces()).toBeGreaterThan(0))
    const stored = await db.countTraces()
    const shown = counts(view.container).shown

    vi.mocked(db.clearTraces).mockRejectedValueOnce(quota())
    fireEvent.click(screen.getByRole('button', { name: /Clear retained trace history/ }))
    await settle()

    const note = await screen.findByText(/history was NOT deleted/)
    expect(note.textContent).toContain('QuotaExceededError')
    expect(note.textContent).toContain('still in storage')

    // 🔴 And it is telling the truth: the rows really are still there. An emptied
    // table plus this message would contradict itself, and the rows would come back
    // on reload.
    expect(await db.countTraces()).toBe(stored)
    expect(counts(view.container)).toEqual({ shown, retained: stored })
  })

  it('says nothing when the delete works', async () => {
    await connected()
    await waitFor(async () => expect(await db.countTraces()).toBeGreaterThan(0))

    fireEvent.click(screen.getByRole('button', { name: /Clear retained trace history/ }))
    await settle()

    // The negative step: no message, and the history is actually gone. Without this
    // the assertions above would pass on a table that always complains.
    expect(screen.queryByText(/history was NOT deleted/)).toBeNull()
    expect(screen.queryByText(/not saving to browser storage/)).toBeNull()
    expect(await db.countTraces()).toBe(0)
  })
})

describe('a healthy console', () => {
  it('carries no storage message at all', async () => {
    await connected()
    expect(screen.queryByText(/browser storage/)).toBeNull()
    expect(screen.queryByText(/could not be read/)).toBeNull()
    expect(screen.queryByText(/NOT deleted/)).toBeNull()
  })
})
