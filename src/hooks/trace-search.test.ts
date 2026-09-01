import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as db from '@/lib/trace-db'
import { DEFAULT_SETTINGS, type Settings } from '@/lib/settings'
import { NO_FILTER } from '@/lib/trace-filter'
import { useConsoleUnderTest } from '@/test/console-driver'
import { GO_CONNECT, FIXTURE_NEWEST_EPOCH, traceFrame } from '@/test/stream-fixtures'
import { FakeEventSource, installFakeEventSource, replay } from '@/test/sse-stream'
import type { RequestTrace } from '@/lib/types'

/**
 * Filtering the trace table is a query over everything retained.
 *
 * 🔴 It used to filter the loaded page and lean on infinite scroll to widen it. Three
 * things were wrong with that, all measured in a browser on a 47,320-row store:
 *
 *  1. The proximity test that drives infinite scroll compares against the *filtered*
 *     count, so a filter matching almost nothing satisfied it forever — 189 IndexedDB
 *     page reads in three seconds, the control blinking between "Load older" and
 *     "loading…", walking toward paging the whole store into memory.
 *  2. It made the operator press a button until matches appeared. The two 404s in that
 *     store sat 4,381 rows down: 22 presses.
 *  3. Until they did, the panel said "No traces match" — which was false.
 *
 * So the store answers a filter with one cursor scan, reports a single searching state
 * while it runs, and pages internally if there are more matches than fit. These
 * scenarios pin all three, against a real IndexedDB with nothing mocked.
 */

const ON_CONNECT = 5
/**
 * The Go capture carries one 404 (`/missing` → `/greeter`) among its five traces, so an
 * "errors" filter always matches it too. Named rather than folded into the numbers,
 * because a future fixture change should break these tests loudly rather than quietly
 * shift what they assert.
 */
const FIXTURE_ERRORS = 1
/** Debounce inside the store, plus room for the scan. */
const SEARCH_MS = 400

const settings = (over: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...over })

async function settle(ms = 0): Promise<void> {
  await act(async () => {
    if (ms) await new Promise((r) => setTimeout(r, ms))
    for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0))
  })
}

async function connected(s = settings()) {
  const hook = renderHook(() => useConsoleUnderTest(s))
  await act(async () => {
    const es = FakeEventSource.current()
    es.emit('open')
    replay(es, GO_CONNECT)
  })
  await settle()
  return hook
}

/**
 * History older than anything the stream sends, written straight to storage.
 *
 * `errorAt` marks which of them is a 404, so a scenario can bury a match far enough
 * back that no page of the loaded window could reach it.
 */
async function seedHistory(count: number, errorAt: number[] = []): Promise<void> {
  const rows: RequestTrace[] = []
  for (let i = 0; i < count; i++) {
    const t = JSON.parse(traceFrame(i, FIXTURE_NEWEST_EPOCH - (count - i) * 60_000))[0] as RequestTrace
    rows.push({
      ...t,
      traceId: `old${String(i).padStart(13, '0')}`,
      uri: errorAt.includes(i) ? '/missing' : '/hello',
      status: errorAt.includes(i) ? 404 : 200,
    })
  }
  await db.upsertTraces(rows)
}

let restoreEventSource: () => void

beforeEach(async () => {
  restoreEventSource = installFakeEventSource()
  await db.clearTraces()
})

afterEach(async () => {
  vi.restoreAllMocks()
  restoreEventSource()
  await db.clearTraces()
})

describe('a filter whose matches are buried in history', () => {
  it('finds them without the operator paging toward them', async () => {
    // 600 rows of history with two 404s near the very bottom — far past the 200-row
    // page the view starts with.
    await seedHistory(600, [3, 11])
    const { result } = await connected()
    await waitFor(async () => expect(await db.countTraces()).toBe(600 + ON_CONNECT))
    expect(result.current.store.rows.length).toBeLessThan(600)

    act(() => {
      result.current.store.setFilter({ ...NO_FILTER, chip: 'errors' })
    })
    await settle(SEARCH_MS)

    // 🔴 Both buried matches, from one scan, with no `loadOlder` call anywhere.
    await waitFor(() => expect(result.current.store.rows).toHaveLength(2 + FIXTURE_ERRORS))
    expect(result.current.store.rows.every((r) => r.status === 404)).toBe(true)
    // Newest match first, like the unfiltered view.
    expect(result.current.store.rows[0].epochMillis).toBeGreaterThan(result.current.store.rows[1].epochMillis)
    // The two seeded 404s are in there, not just the fixture's.
    expect(result.current.store.rows.filter((r) => r.traceId?.startsWith('old'))).toHaveLength(2)
  })

  it('says it is searching while it walks, and only then', async () => {
    await seedHistory(600, [3])
    const { result } = await connected()
    expect(result.current.store.searching).toBe(false)

    act(() => {
      result.current.store.setFilter({ ...NO_FILTER, chip: 'errors' })
    })
    // One state, entered immediately — the operator is not shown an empty table that
    // then fills, nor a control that flickers.
    expect(result.current.store.searching).toBe(true)

    await settle(SEARCH_MS)
    await waitFor(() => expect(result.current.store.searching).toBe(false))
  })

  it('offers nothing more to load once the scan reached the end', async () => {
    // `hasMore` under a filter means "more matches to find", and the scan knows it
    // walked past the oldest row. That is what takes the button away truthfully.
    await seedHistory(600, [3, 11])
    const { result } = await connected()

    act(() => {
      result.current.store.setFilter({ ...NO_FILTER, chip: 'errors' })
    })
    await settle(SEARCH_MS)

    await waitFor(() => expect(result.current.store.rows).toHaveLength(2 + FIXTURE_ERRORS))
    expect(result.current.store.hasMore).toBe(false)
  })

  it('scans once per filter, not once per page of history', async () => {
    const find = vi.spyOn(db, 'findTraces')
    const page = vi.spyOn(db, 'getTracePage')
    await seedHistory(600, [3])
    const { result } = await connected()
    page.mockClear()

    act(() => {
      result.current.store.setFilter({ ...NO_FILTER, chip: 'errors' })
    })
    await settle(SEARCH_MS)
    await waitFor(() => expect(result.current.store.rows).toHaveLength(1 + FIXTURE_ERRORS))

    // 🔴 The count that used to run to 189.
    expect(find).toHaveBeenCalledTimes(1)
    expect(page).not.toHaveBeenCalled()
  })
})

describe('more matches than fit one page', () => {
  it('pages internally, keeping the newest first', async () => {
    // 12 matches with a page size of 5: the first scan stops early and says so.
    await seedHistory(40, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
    const { result } = await connected(settings({ pageSize: 5 }))

    act(() => {
      result.current.store.setFilter({ ...NO_FILTER, chip: 'errors' })
    })
    await settle(SEARCH_MS)

    await waitFor(() => expect(result.current.store.rows).toHaveLength(5))
    expect(result.current.store.hasMore).toBe(true)

    act(() => {
      result.current.store.loadOlder()
    })
    await settle(SEARCH_MS)

    await waitFor(() => expect(result.current.store.rows).toHaveLength(10))
    // Still ordered, and no duplicates across the two pages.
    const keys = result.current.store.rows.map((r) => r._key)
    expect(new Set(keys).size).toBe(keys.length)
    for (let i = 1; i < result.current.store.rows.length; i++) {
      expect(result.current.store.rows[i].epochMillis).toBeLessThan(result.current.store.rows[i - 1].epochMillis)
    }
  })
})

describe('traffic arriving while a filter is up', () => {
  it('shows a new match immediately — the scan could not have known about it', async () => {
    await seedHistory(300, [3])
    const { result } = await connected()

    act(() => {
      result.current.store.setFilter({ ...NO_FILTER, chip: 'errors' })
    })
    await settle(SEARCH_MS)
    await waitFor(() => expect(result.current.store.rows).toHaveLength(1 + FIXTURE_ERRORS))

    // A 404 arrives now. It is newer than everything the scan saw.
    await act(async () => {
      const frame = JSON.parse(traceFrame(9001, FIXTURE_NEWEST_EPOCH + 5_000))
      frame[0].uri = '/missing'
      frame[0].status = 404
      FakeEventSource.current().emit('trace', JSON.stringify(frame))
    })
    await settle()

    await waitFor(() => expect(result.current.store.rows).toHaveLength(2 + FIXTURE_ERRORS))
    expect(result.current.store.rows[0].status).toBe(404)
    expect(result.current.store.rows[0].epochMillis).toBe(FIXTURE_NEWEST_EPOCH + 5_000)
  })

  it('keeps a non-matching arrival out', async () => {
    // The negative step: live merging must not smuggle rows past the filter.
    await seedHistory(300, [3])
    const { result } = await connected()

    act(() => {
      result.current.store.setFilter({ ...NO_FILTER, chip: 'errors' })
    })
    await settle(SEARCH_MS)
    await waitFor(() => expect(result.current.store.rows).toHaveLength(1 + FIXTURE_ERRORS))

    await act(async () => {
      FakeEventSource.current().emit('trace', traceFrame(9002, FIXTURE_NEWEST_EPOCH + 6_000))
    })
    await settle()

    expect(result.current.store.rows).toHaveLength(1 + FIXTURE_ERRORS)
  })
})

describe('changing the filter while a scan is in flight', () => {
  it('shows the answer to the filter that is up, not the one that was', async () => {
    // Without the generation guard the slower earlier scan lands last and the table
    // shows rows that do not match what the chips say — the shape of defect the module
    // detail panel already had once.
    await seedHistory(600, [3, 11])
    const { result } = await connected()

    act(() => {
      result.current.store.setFilter({ ...NO_FILTER, chip: 'errors' })
    })
    act(() => {
      result.current.store.setFilter({ ...NO_FILTER, query: 'missing' })
    })
    await settle(SEARCH_MS)

    await waitFor(() => expect(result.current.store.searching).toBe(false))
    expect(result.current.store.filter.query).toBe('missing')
    expect(result.current.store.rows.every((r) => r.uri.includes('missing'))).toBe(true)
  })

  it('🔴 discards a slow scan that lands after the filter moved on', async () => {
    // The previous scenario changes the filter inside the debounce window, so the first
    // scan never starts and the generation guard is never reached (measured: removing
    // the guard broke nothing). This one makes the first scan genuinely slow, so its
    // result arrives *after* the second one has already answered.
    //
    // Without the guard that stale result overwrites the current one, and because a
    // result is keyed to the filter it answers, the view then has no answer for the
    // filter that is up — it sits on "searching" forever with an empty table.
    await seedHistory(300, [3])
    const real = db.findTraces
    let call = 0
    vi.spyOn(db, 'findTraces').mockImplementation(async (filter, limit, before) => {
      call += 1
      if (call === 1) {
        await new Promise((r) => setTimeout(r, 400))
        return real(filter, limit, before)
      }
      return real(filter, limit, before)
    })

    const { result } = await connected()
    act(() => {
      result.current.store.setFilter({ ...NO_FILTER, chip: 'errors' })
    })
    // Past the debounce: the slow scan is now in flight.
    await settle(260)
    act(() => {
      result.current.store.setFilter({ ...NO_FILTER, query: 'missing' })
    })
    // Long enough for the second scan to answer AND the first to land late.
    await settle(900)

    await waitFor(() => expect(result.current.store.searching).toBe(false))
    expect(result.current.store.filter.query).toBe('missing')
    expect(result.current.store.rows.length).toBeGreaterThan(0)
    expect(result.current.store.rows.every((r) => r.uri.includes('missing'))).toBe(true)
  })

  it('drops back to the whole window when the filter is cleared', async () => {
    await seedHistory(300, [3])
    const { result } = await connected()

    act(() => {
      result.current.store.setFilter({ ...NO_FILTER, chip: 'errors' })
    })
    await settle(SEARCH_MS)
    await waitFor(() => expect(result.current.store.rows).toHaveLength(1 + FIXTURE_ERRORS))
    const filtered = result.current.store.rows.length

    act(() => {
      result.current.store.setFilter(NO_FILTER)
    })
    await settle()

    expect(result.current.store.searching).toBe(false)
    expect(result.current.store.rows.length).toBeGreaterThan(filtered)
  })
})

// These drive `findTraces` directly, so no stream fixture is involved and the seeded
// rows are the only ones in the store.
describe('the scan itself', () => {
  it('stops early at the limit and reports that it did', async () => {
    await seedHistory(30, [0, 1, 2, 3, 4])
    const found = await db.findTraces({ ...NO_FILTER, chip: 'errors' }, 3)
    expect(found.rows).toHaveLength(3)
    expect(found.complete).toBe(false)
  })

  it('reports completion when it walked past the oldest row', async () => {
    await seedHistory(30, [0, 1])
    const found = await db.findTraces({ ...NO_FILTER, chip: 'errors' }, 10)
    expect(found.rows).toHaveLength(2)
    expect(found.complete).toBe(true)
  })

  it('continues from a given epoch without repeating a row', async () => {
    await seedHistory(30, [0, 1, 2, 3, 4])
    const first = await db.findTraces({ ...NO_FILTER, chip: 'errors' }, 2)
    const next = await db.findTraces({ ...NO_FILTER, chip: 'errors' }, 10, first.rows[1].epochMillis)
    const overlap = next.rows.filter((r) => first.rows.some((f) => f._key === r._key))
    expect(overlap).toHaveLength(0)
    expect(first.rows.length + next.rows.length).toBe(5)
  })

  it('walks a store with no matches to the end and says so', async () => {
    await seedHistory(300)
    const found = await db.findTraces({ ...NO_FILTER, chip: 'errors' }, 200)
    expect(found.rows).toHaveLength(0)
    expect(found.complete).toBe(true)
  })
})
