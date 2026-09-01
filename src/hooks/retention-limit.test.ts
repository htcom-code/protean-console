import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as db from '@/lib/trace-db'
import { DEFAULT_SETTINGS, type Settings } from '@/lib/settings'
import { useConsoleUnderTest } from '@/test/console-driver'
import { GO_CONNECT, FIXTURE_NEWEST_EPOCH, traceFrame } from '@/test/stream-fixtures'
import { FakeEventSource, installFakeEventSource, replay } from '@/test/sse-stream'

/**
 * What happens when the retained history reaches its limit.
 *
 * Before this, nothing enforced the limit on the way in: rows were inserted and the
 * old pruner ran on a count that never came back down under pressure, so a full
 * store meant every later batch was refused for the same reason — the failure kept
 * itself alive and the console reported a storage error forever. The limit now has
 * to *evict* to make room, and these scenarios pin the arithmetic of that eviction
 * against a real IndexedDB.
 *
 * The limit here is a handful of rows, not the 50,000 the dialog enforces. That
 * floor is a UI rule; the store is limit-agnostic, and a scenario that had to push
 * 50,001 traces through the stream would measure the same code far more slowly. The
 * default is asserted separately, so the two cannot drift apart.
 */
vi.mock('@/lib/trace-db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/trace-db')>()
  return { ...actual, upsertTraces: vi.fn(actual.upsertTraces) }
})

const quota = () => new DOMException('The quota has been exceeded.', 'QuotaExceededError')

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
  // `mockReset`, not `mockClear`: a persistent `mockRejectedValue` from an earlier
  // test survives `mockClear` and `vi.restoreAllMocks` alike, and would make every
  // later scenario silently store nothing. Reset puts back the real implementation
  // this mock was created with.
  vi.mocked(db.upsertTraces).mockReset()
  await db.clearTraces()
})

afterEach(() => {
  vi.restoreAllMocks()
  restoreEventSource()
})

describe('a store that has reached its limit', () => {
  it('keeps accepting new traces, evicting the oldest to fit', async () => {
    await connected(withRetention(8))

    await arrive(1) // 6
    await arrive(2) // 7
    await arrive(3) // 8 — at the limit, still nothing to evict
    expect(await db.countTraces()).toBe(8)

    const before = await db.getTracePage(20)
    const oldest = before[before.length - 1]

    await arrive(4) // 9 in, 1 evicted

    // 🔴 The point of the fix: the newest trace is stored and the count is back at
    // the limit. Previously the insert went through and the count kept climbing
    // until the browser refused it, and from then on nothing was saved at all.
    expect(await db.countTraces()).toBe(8)
    const after = await db.getTracePage(20)
    expect(after[0].epochMillis).toBe(FIXTURE_NEWEST_EPOCH + 4_000)

    // And it is the *oldest* row that went, not the arrival.
    expect(after.map((r) => r._key)).not.toContain(oldest._key)
    expect(after.every((r) => r.epochMillis > oldest.epochMillis)).toBe(true)
  })

  it('stays at the limit batch after batch instead of drifting', async () => {
    const { result } = await connected(withRetention(8))
    for (let n = 1; n <= 6; n++) {
      await arrive(n)
      expect(await db.countTraces(), `after arrival ${n}`).toBeLessThanOrEqual(8)
    }
    // The limit is crossed on the fourth arrival and never re-crossed.
    // Every arrival after the eighth row evicts exactly one, so the store sits on
    // the limit rather than sliding below it — which is what feeding the eviction
    // count `fresh.length` (the whole re-persisted window, ~500 rows) used to do.
    expect(await db.countTraces()).toBe(8)
    expect(result.current.store.storage.failed).toBe(0)
  })

  it('drops further below the limit when the user asks for a higher factor', async () => {
    // Factor 4 buys headroom: one arrival over the limit evicts four, so the next
    // three batches fit without touching the pruner.
    const { result } = await connected(withRetention(8, { evictionFactor: 4 }))
    await arrive(1)
    await arrive(2)
    await arrive(3)
    expect(await db.countTraces()).toBe(8)

    await arrive(4)
    expect(await db.countTraces()).toBe(5)
    expect(result.current.store.storage.failed).toBe(0)
  })

  it('reports the count that is actually stored', async () => {
    const { result } = await connected(withRetention(8))
    for (let n = 1; n <= 4; n++) await arrive(n)
    await waitFor(() => expect(result.current.store.total).toBe(8))
    expect(result.current.store.total).toBe(await db.countTraces())
  })
})

describe('a write the browser refuses because the store is full', () => {
  it('frees room and saves it on the second attempt, without crying failure', async () => {
    const { result } = await connected(withRetention(8))

    // The refusal arrives on the insert, which is where quota bites — before the
    // fix, eviction ran only *after* a successful insert, so a refused write freed
    // nothing and the next batch was refused identically. Forever.
    vi.mocked(db.upsertTraces).mockRejectedValueOnce(quota())
    await arrive(1)

    expect(await db.countTraces()).toBeGreaterThan(0)
    const stored = await db.getTracePage(20)
    expect(stored[0].epochMillis).toBe(FIXTURE_NEWEST_EPOCH + 1_000)
    // The whole live window went back in, so the retry cost nothing here. In
    // production the window (500) is far smaller than the limit (50,000), and the
    // rows freed to make room are genuinely gone — which is the trade the limit is.
    expect(await db.countTraces()).toBe(ON_CONNECT + 1)

    // Nothing is reported, because nothing was lost: the retry succeeded. Room was
    // made by deleting older rows, which is the trade the limit exists to make.
    expect(result.current.store.storage.failed).toBe(0)
    expect(result.current.store.storage.total).toBe(0)
    expect(vi.mocked(db.upsertTraces).mock.calls.length).toBeGreaterThan(1)
  })

  it('reports the failure when there is nothing left to give back', async () => {
    // An empty store cannot buy space, so the retry is pointless and the original
    // error is what the operator needs to see. Without the `freed === 0` check the
    // retry would repeat the same refusal and report *that* one instead — same name
    // here, but it is the first failure that is the true one.
    const hook = renderHook(() => useConsoleUnderTest(withRetention(8)))
    vi.mocked(db.upsertTraces).mockRejectedValue(quota())
    await act(async () => {
      const es = FakeEventSource.current()
      es.emit('open')
      replay(es, GO_CONNECT)
    })
    await settle()

    expect(await db.countTraces()).toBe(0)
    expect(hook.result.current.store.storage.failed).toBe(1)
    expect(hook.result.current.store.storage.op).toBe('write')
    expect(hook.result.current.store.storage.lastError).toBe('QuotaExceededError')

    // The rows are still on screen — unsaved, and said to be unsaved.
    expect(hook.result.current.store.rows.length).toBeGreaterThan(0)
  })
})

describe('the limit the console ships with', () => {
  it('is the floor the settings dialog enforces', () => {
    // The scenarios above run on a tiny limit for speed. This is the one users get.
    expect(DEFAULT_SETTINGS.retention).toBe(50_000)
    expect(DEFAULT_SETTINGS.evictionFactor).toBe(1)
  })

  it('leaves a store well under the limit untouched', async () => {
    const { result } = await connected(DEFAULT_SETTINGS)
    await arrive(1)
    expect(await db.countTraces()).toBe(ON_CONNECT + 1)
    expect(result.current.store.storage.failed).toBe(0)
  })
})
