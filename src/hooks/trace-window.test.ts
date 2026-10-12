import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as db from '@/lib/trace-db'
import { DEFAULT_SETTINGS, type Settings } from '@/lib/settings'
import { useConsoleUnderTest } from '@/test/console-driver'
import { GO_CONNECT, FIXTURE_NEWEST_EPOCH, traceFrame } from '@/test/stream-fixtures'
import { FakeEventSource, installFakeEventSource, replay } from '@/test/sse-stream'

/**
 * The trace list against the store underneath it.
 *
 * The list used to only grow: every batch merged in and nothing came out except a
 * clear. That cost a sort over the whole session per batch, and — the reason this
 * file exists — eviction removed rows from IndexedDB without removing them from the
 * list. Measured on the old code with a limit of 8: after ten arrivals the header
 * read "15 shown · 8 retained", and 7 of the rows on screen existed nowhere else.
 *
 * Limits are tiny here for the reason `retention-limit.test.ts` gives: the store is
 * limit-agnostic and the dialog's floor is asserted there.
 */

const withRetention = (retention: number, over: Partial<Settings> = {}): Settings => ({
  ...DEFAULT_SETTINGS,
  retention,
  ...over,
})

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
  })
}

/** Traces in the platform's connect dump — the store's starting count. */
const ON_CONNECT = 5

/** Connect and deliver the fixture dump, all of it persisted. */
async function connected(settings: Settings) {
  const hook = renderHook(() => useConsoleUnderTest(settings))
  await act(async () => {
    const es = FakeEventSource.current()
    es.emit('open')
    replay(es, GO_CONNECT)
  })
  await waitFor(async () => expect(await db.countTraces()).toBe(ON_CONNECT))
  return hook
}

/** Deliver one trace newer than everything so far. */
async function arrive(n: number): Promise<void> {
  await act(async () => {
    FakeEventSource.current().emit('trace', traceFrame(9000 + n, FIXTURE_NEWEST_EPOCH + n * 1_000))
  })
  await settle()
}

let restoreEventSource: () => void

beforeEach(async () => {
  restoreEventSource = installFakeEventSource()
  await db.clearTraces()
})

afterEach(() => {
  restoreEventSource()
})

const stored = async () => new Set((await db.getTracePage(1_000)).map((r) => r._key))

describe('the list after eviction', () => {
  it('never shows a row storage no longer holds', async () => {
    const { result } = await connected(withRetention(8))
    for (let n = 1; n <= 10; n++) {
      await arrive(n)
      await waitFor(async () => expect(result.current.store.total).toBe(await db.countTraces()))
      const { rows, total } = result.current.store
      expect(rows.length, `after arrival ${n}: ${rows.length} shown · ${total} retained`).toBeLessThanOrEqual(total)
    }
    const keys = await stored()
    const ghosts = result.current.store.rows.filter((r) => !keys.has(r._key))
    expect(ghosts.map((r) => r._key)).toEqual([])
  })

  it('drops evicted rows from a search result too', async () => {
    // A filter is answered from storage, so its result is a list of stored rows —
    // and the same eviction takes some of them away.
    const { result } = await connected(withRetention(8))
    for (let n = 1; n <= 3; n++) await arrive(n)
    act(() => result.current.store.setFilter({ chip: 'all', query: 'hello' }))
    await waitFor(() => expect(result.current.store.searching).toBe(false))
    const before = result.current.store.rows.length

    for (let n = 4; n <= 8; n++) await arrive(n)

    const keys = await stored()
    expect(result.current.store.rows.filter((r) => !keys.has(r._key)).map((r) => r._key)).toEqual([])
    expect(result.current.store.rows.length).toBeGreaterThan(0)
    expect(before).toBeGreaterThan(0)
  })
})

describe('the list under steady traffic', () => {
  it('holds one page, pushing the oldest out of the bottom', async () => {
    const { result } = await connected(withRetention(1_000, { pageSize: 4 }))
    for (let n = 1; n <= 6; n++) await arrive(n)

    const { rows } = result.current.store
    expect(rows).toHaveLength(4)
    // The newest four, in order — the window slides, it does not freeze.
    expect(rows.map((r) => r.epochMillis)).toEqual([6, 5, 4, 3].map((n) => FIXTURE_NEWEST_EPOCH + n * 1_000))
    // What left the list is still in storage, and the list says there is more.
    expect(await db.countTraces()).toBe(ON_CONNECT + 6)
    expect(result.current.store.hasMore).toBe(true)
  })

  it('grows only by what the user loads', async () => {
    const { result } = await connected(withRetention(1_000, { pageSize: 4 }))
    for (let n = 1; n <= 6; n++) await arrive(n)

    act(() => result.current.store.loadOlder())
    await waitFor(() => expect(result.current.store.rows).toHaveLength(8))
    // The rows the window had pushed out come back from storage, oldest last.
    expect(result.current.store.rows[4].epochMillis).toBe(FIXTURE_NEWEST_EPOCH + 2_000)

    // And the deeper window holds through the next arrival instead of snapping back.
    await arrive(7)
    expect(result.current.store.rows).toHaveLength(8)
    expect(result.current.store.rows[0].epochMillis).toBe(FIXTURE_NEWEST_EPOCH + 7_000)
  })

  it('says there is nothing more once storage is exhausted', async () => {
    const { result } = await connected(withRetention(1_000, { pageSize: 4 }))
    await arrive(1) // 6 stored, 4 shown
    act(() => result.current.store.loadOlder())
    await waitFor(() => expect(result.current.store.rows).toHaveLength(6))
    await waitFor(() => expect(result.current.store.hasMore).toBe(false))
  })
})
