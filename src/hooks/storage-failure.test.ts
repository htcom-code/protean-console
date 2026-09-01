import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as db from '@/lib/trace-db'
import { useConsoleUnderTest } from '@/test/console-driver'
import { GO_CONNECT, FIXTURE_NEWEST_EPOCH, traceFrame } from '@/test/stream-fixtures'
import { FakeEventSource, installFakeEventSource, replay } from '@/test/sse-stream'

/**
 * What the console does when the browser refuses to store what it is showing.
 *
 * IndexedDB can refuse a write (quota), refuse to open (private browsing, blocked
 * site data), or fail a delete — and until now every one of those was swallowed.
 * Each failure produced a different false statement on screen, which is what these
 * scenarios pin: an unread history looked like an empty one, unwritten rows looked
 * retained, and a failed delete looked like a successful one.
 *
 * Failures are injected at the store's own boundary — the functions it imports from
 * `trace-db` — rather than by breaking IndexedDB itself. The happy paths in the
 * other suites keep running against real storage.
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

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
  })
}

/**
 * Wait until the store and IndexedDB agree, so a snapshot of one is a snapshot of
 * both.
 *
 * `countTraces() > 0` is not enough: the write path counts, inserts, counts again
 * and prunes before it calls `setTotal`/`setRows`, so a poll can catch it
 * mid-pipeline and the continuation then lands *after* the snapshot — the
 * assertions compare against a state that has since moved. Measured: this test
 * failed roughly once in a dozen runs that way.
 */
async function quiesced(total: () => number): Promise<number> {
  await waitFor(async () => {
    const stored = await db.countTraces()
    expect(stored).toBeGreaterThan(0)
    expect(total()).toBe(stored)
  })
  await settle()
  return db.countTraces()
}

/** Connect and deliver the fixture dump, so there is something to store. */
async function connected() {
  const hook = renderHook(() => useConsoleUnderTest())
  await act(async () => {
    const es = FakeEventSource.current()
    es.emit('open')
    replay(es, GO_CONNECT)
  })
  return hook
}

let restoreEventSource: () => void

beforeEach(async () => {
  restoreEventSource = installFakeEventSource()
  vi.mocked(db.upsertTraces).mockClear()
  vi.mocked(db.getTracePage).mockClear()
  vi.mocked(db.clearTraces).mockClear()
  await db.clearTraces()
})

afterEach(() => {
  vi.restoreAllMocks()
  restoreEventSource()
})

describe('a write the browser refuses', () => {
  it('says the rows are not being saved, and names the error', async () => {
    vi.mocked(db.upsertTraces).mockRejectedValueOnce(quota())
    const { result } = await connected()
    await settle()

    expect(result.current.store.storage.failed).toBe(1)
    expect(result.current.store.storage.total).toBe(1)
    expect(result.current.store.storage.lastError).toBe('QuotaExceededError')
    expect(result.current.store.storage.op).toBe('write')

    // The rows still show — the console stays useful — but nothing was persisted,
    // which is exactly why the screen has to qualify them.
    expect(result.current.store.rows.length).toBeGreaterThan(0)
    expect(await db.countTraces()).toBe(0)
  })

  it('reports on the very first failure, unlike a malformed frame', async () => {
    // Frames are tolerated three times; a lost write is not. Nothing arrives later
    // to make an unsaved row saved.
    vi.mocked(db.upsertTraces).mockRejectedValueOnce(quota())
    const { result } = await connected()
    await settle()
    expect(result.current.store.storage.failed).toBe(1)
  })

  it('clears the mark when the next write succeeds, and keeps the total', async () => {
    vi.mocked(db.upsertTraces).mockRejectedValueOnce(quota())
    const { result } = await connected()
    await settle()
    expect(result.current.store.storage.failed).toBe(1)

    await act(async () => {
      FakeEventSource.current().emit('trace', traceFrame(9101, FIXTURE_NEWEST_EPOCH + 1_000))
    })
    await waitFor(() => expect(result.current.store.storage.failed).toBe(0))

    expect(result.current.store.storage.lastError).toBeNull()
    // The failure still happened, so the total keeps it.
    expect(result.current.store.storage.total).toBe(1)

    // And the rows the failed write dropped are back: the store persists the whole
    // live window on every batch, so the next successful write picks up whatever is
    // still in that window. Measured, not assumed — the loss is only permanent for
    // traces that fall out of the window before a write succeeds, which is why the
    // note says "not in storage yet" rather than promising they are gone.
    expect(await db.countTraces()).toBe(6)
  })
})

describe('a delete the browser refuses', () => {
  it('does not report a deletion that did not happen', async () => {
    const { result } = await connected()
    const stored = await quiesced(() => result.current.store.total)
    const shown = result.current.store.rows.length

    vi.mocked(db.clearTraces).mockRejectedValueOnce(quota())
    await act(async () => {
      result.current.store.clear()
    })
    await settle()

    // 🔴 The view keeps its rows. Emptying it here would claim the history was
    // deleted while it is still in storage — it would come back on the next reload,
    // which is the resurrection #48 fixed arriving by another route.
    expect(result.current.store.rows).toHaveLength(shown)
    expect(result.current.store.total).toBe(stored)
    expect(await db.countTraces()).toBe(stored)

    expect(result.current.store.storage.op).toBe('clear')
    expect(result.current.store.storage.lastError).toBe('QuotaExceededError')
  })

  it('still deletes, and reports success, when storage cooperates', async () => {
    const { result } = await connected()
    await quiesced(() => result.current.store.total)

    await act(async () => {
      result.current.store.clear()
    })
    await settle()

    expect(await db.countTraces()).toBe(0)
    expect(result.current.store.rows).toEqual([])
    expect(result.current.store.storage.failed).toBe(0)
  })
})

describe('a read the browser refuses', () => {
  it('does not let an unreadable history look like an empty one', async () => {
    // Seeding the view is the first thing the store does. If that read fails the
    // table is empty for a reason the operator cannot see otherwise.
    vi.mocked(db.getTracePage).mockRejectedValueOnce(quota())
    const { result } = await connected()
    await settle()

    expect(result.current.store.storage.op).toBe('read')
    expect(result.current.store.storage.lastError).toBe('QuotaExceededError')
  })

  it('stops the load-older spinner instead of turning it forever', async () => {
    const { result } = await connected()
    await settle()

    vi.mocked(db.getTracePage).mockRejectedValueOnce(quota())
    await act(async () => {
      result.current.store.loadOlder()
    })
    await settle()

    // Without a handler the rejection escaped and `loadingOlder` stayed true — a
    // control claiming work is in progress that had already failed.
    expect(result.current.store.loadingOlder).toBe(false)
    expect(result.current.store.storage.op).toBe('read')
  })
})
