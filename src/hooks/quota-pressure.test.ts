import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { countTraces, clearTraces, getTracePage, upsertTraces } from '@/lib/trace-db'
import type { RequestTrace } from '@/lib/types'
import { DEFAULT_SETTINGS, type Settings } from '@/lib/settings'
import { installQuota, recordCost, type QuotaHandle } from '@/test/idb-quota'
import { useConsoleUnderTest } from '@/test/console-driver'
import { GO_CONNECT, FIXTURE_NEWEST_EPOCH, traceFrame } from '@/test/stream-fixtures'
import { FakeEventSource, installFakeEventSource, replay } from '@/test/sse-stream'

/**
 * The console against a browser that has actually run out of room.
 *
 * Every other test of this path injects the failure at our own boundary — mocking
 * `upsertTraces` to reject. That proves what the store does with a rejection and
 * leaves the load-bearing assumption untested: **that IndexedDB can still delete
 * when it is full.** The whole retry rests on it. If a full store refused deletes
 * too, the recovery would be a no-op and the console would report a permanent
 * failure while quietly losing every trace.
 *
 * So here the limit is a byte budget inside IndexedDB itself (`src/test/idb-quota.ts`)
 * and **nothing is mocked**. The store fills for real, a write is refused for real,
 * the pruner's cursor deletes commit for real, and the retry writes into the space
 * they freed.
 *
 * Note which limit bites: `retention` stays at its 50,000 default, so the console's
 * own count-based eviction never fires. This is the case the count limit cannot
 * cover — a limit in rows cannot bound bytes — and it is the case a real deployment
 * hits first.
 */

/** A trace shaped like the fixtures, so `recordCost` measures the real thing. */
const sample = { ...JSON.parse(traceFrame(1, FIXTURE_NEWEST_EPOCH))[0], _key: 'bbbb000000000001' }
const ONE_RECORD = recordCost(sample)

/** Traces in the platform's connect dump. */
const ON_CONNECT = 5

const withRetention = (over: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...over })

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0))
  })
}

async function connected(settings = withRetention()) {
  const hook = renderHook(() => useConsoleUnderTest(settings))
  await act(async () => {
    const es = FakeEventSource.current()
    es.emit('open')
    replay(es, GO_CONNECT)
  })
  await settle()
  return hook
}

/**
 * Put history into storage directly, older than anything the stream will send.
 *
 * A cold store cannot demonstrate the retry: the console re-persists its whole live
 * window on every batch, so when the store holds only that window there is nothing
 * to evict that is not about to be written again. Retained history from earlier
 * sessions is what eviction actually spends — which is also the real shape of the
 * problem, since a browser refuses a write long after the history outgrew the window.
 */
async function seedHistory(count: number): Promise<void> {
  const rows: RequestTrace[] = []
  for (let i = 0; i < count; i++) {
    rows.push({
      ...(JSON.parse(traceFrame(i, FIXTURE_NEWEST_EPOCH - (count - i) * 60_000))[0] as RequestTrace),
      traceId: `old${String(i).padStart(13, '0')}`,
    })
  }
  await upsertTraces(rows)
}

/** Deliver one trace newer than everything so far. */
async function arrive(n: number): Promise<void> {
  await act(async () => {
    FakeEventSource.current().emit('trace', traceFrame(9000 + n, FIXTURE_NEWEST_EPOCH + n * 1_000))
  })
  await settle()
}

let restoreEventSource: () => void
let quota: QuotaHandle | null = null

beforeEach(async () => {
  restoreEventSource = installFakeEventSource()
  await clearTraces()
})

afterEach(async () => {
  quota?.restore()
  quota = null
  restoreEventSource()
  await clearTraces()
})

describe('a store that has physically run out of room', () => {
  it('keeps saving — the refused write frees space and lands on the retry', async () => {
    // 20 rows of retained history, and room for about 30. The connect dump and a few
    // arrivals fit; then the store is full and only the history can be spent.
    // The budget counts writes made after it is installed, so the seed goes second.
    quota = installQuota(ONE_RECORD * 30)
    await seedHistory(20)
    const { result } = await connected()

    await waitFor(async () => expect(await countTraces()).toBe(20 + ON_CONNECT))
    const refusalsBefore = quota.refusals

    for (let n = 1; n <= 8; n++) await arrive(n)

    // 🔴 The budget really did bite. Without this the rest passes for the wrong
    // reason and the scenario proves nothing.
    expect(quota.refusals).toBeGreaterThan(refusalsBefore)

    // And nothing is reported, because nothing was lost: the deletes committed while
    // the store was full and the second write went through. This is the assumption
    // the retry rests on, and it could not be tested until now.
    await waitFor(() => expect(result.current.store.storage.failed).toBe(0))

    const stored = await getTracePage(100)
    expect(stored[0].epochMillis).toBe(FIXTURE_NEWEST_EPOCH + 8_000)
    expect(quota.used).toBeLessThanOrEqual(quota.bytes)
  })

  it('spends the oldest history, not the arrival', async () => {
    // The budget counts writes made after it is installed, so the seed goes second.
    quota = installQuota(ONE_RECORD * 30)
    await seedHistory(20)
    await connected()
    await waitFor(async () => expect(await countTraces()).toBe(20 + ON_CONNECT))

    const before = await getTracePage(100)
    const oldest = before[before.length - 1]

    for (let n = 1; n <= 8; n++) await arrive(n)

    const after = await getTracePage(100)
    expect(after.map((r) => r._key)).not.toContain(oldest._key)
    expect(after.every((r) => r.epochMillis > oldest.epochMillis)).toBe(true)
  })

  it('cannot recover when the incoming window alone exceeds the quota', async () => {
    // 🔴 A boundary this work uncovered. Eviction buys room for the *batch*, and the
    // batch is the whole live window re-persisted. If that window does not fit in the
    // quota at all, there is nothing to free that is not immediately written back, and
    // the retry fails for the same reason as the first attempt.
    //
    // The console's answer is the right one — it says storage is refusing and keeps
    // showing the traces — but it is worth pinning that this state exists rather than
    // discovering it in a browser. It arrives when the quota is tiny relative to
    // `TRACE_WINDOW` (500), which on a real origin means a nearly-exhausted quota.
    quota = installQuota(ONE_RECORD * 6)
    await seedHistory(4)
    const { result } = await connected()

    for (let n = 1; n <= 8; n++) await arrive(n)

    await waitFor(() => expect(result.current.store.storage.failed).toBeGreaterThan(0))
    expect(result.current.store.storage.lastError).toBe('QuotaExceededError')
    // The rows are still on screen, and still qualified as unsaved.
    expect(result.current.store.rows.length).toBeGreaterThan(0)
  })

  it('reports the failure when even one batch cannot fit', async () => {
    // A budget smaller than the connect dump. There is nothing to evict on a cold
    // store, so freeing space is impossible and the honest answer is to say so.
    quota = installQuota(ONE_RECORD * 2)
    const { result } = await connected()

    await waitFor(() => expect(result.current.store.storage.failed).toBeGreaterThan(0))
    expect(result.current.store.storage.op).toBe('write')
    expect(result.current.store.storage.lastError).toBe('QuotaExceededError')

    // The rows are still on screen — unsaved, and said to be unsaved.
    expect(result.current.store.rows.length).toBeGreaterThan(0)
    expect(await countTraces()).toBe(0)
  })

  it('recovers, and drops the message, once the browser gives room back', async () => {
    // A user clearing other site data is the real-world exit from a full quota.
    quota = installQuota(ONE_RECORD * 2)
    const { result } = await connected()
    await waitFor(() => expect(result.current.store.storage.failed).toBeGreaterThan(0))

    quota.resize(ONE_RECORD * 40)
    await arrive(1)

    await waitFor(() => expect(result.current.store.storage.failed).toBe(0))
    expect(result.current.store.storage.lastError).toBeNull()
    // The failure still happened, so the session total keeps it.
    expect(result.current.store.storage.total).toBeGreaterThan(0)
    expect(await countTraces()).toBeGreaterThan(0)
  })

  it('does not overstate what is still retained after a failed batch', async () => {
    // 🔴 The retained count used to move only on success. But the retry evicts before
    // it writes, so a batch that ends in failure has still deleted rows — and the
    // header kept reporting the last successful number. Measured in a browser: it read
    // 49,985 while the store held 48,212, and overstated further with every batch.
    // The note said rows were not being saved; the number beside it said the rest were
    // still there.
    quota = installQuota(ONE_RECORD * 30)
    await seedHistory(20)
    const { result } = await connected()
    await waitFor(async () => expect(await countTraces()).toBe(20 + ON_CONNECT))

    // Shrink the budget so the window can no longer fit: every batch now evicts and
    // then fails, which is exactly the state that produced the wrong number.
    quota.resize(ONE_RECORD * 6)
    for (let n = 1; n <= 4; n++) await arrive(n)

    await waitFor(() => expect(result.current.store.storage.failed).toBeGreaterThan(0))
    const stored = await countTraces()
    expect(stored).toBeLessThan(20 + ON_CONNECT) // eviction really did burn history
    await waitFor(() => expect(result.current.store.total).toBe(stored))
  })

  it('leaves nothing behind from the refused transaction', async () => {
    // A partially-applied batch would be worse than a refused one: the count would
    // move, the console would report success, and the store would hold a fragment
    // of a window nobody can reason about.
    quota = installQuota(ONE_RECORD * 2)
    await connected()
    await settle()
    expect(await countTraces()).toBe(0)
  })
})

describe('the count limit and the byte limit are different limits', () => {
  it('shows the row limit cannot prevent a quota failure', async () => {
    // Retention is 50,000 rows and the store holds five. By any count-based measure
    // there is room; the browser still refuses. This is why the retry exists, and
    // why a per-server row limit will not be enough once histories multiply.
    quota = installQuota(ONE_RECORD * 2)
    const { result } = await connected(withRetention({ retention: 50_000 }))

    await waitFor(() => expect(result.current.store.storage.lastError).toBe('QuotaExceededError'))
    expect(result.current.store.rows.length).toBeLessThan(50_000)
  })
})
