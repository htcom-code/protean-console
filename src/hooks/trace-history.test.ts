import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useConsoleUnderTest } from '@/test/console-driver'
import {
  FIXTURE_NEWEST_EPOCH,
  PLATFORMS,
  traceFrame,
} from '@/test/stream-fixtures'
import { FakeEventSource, installFakeEventSource, replay, tracesIn } from '@/test/sse-stream'
import { clearTraces, countTraces, getTracePage } from '@/lib/trace-db'

/**
 * Scenarios, not unit tests: each one drives the real stream hook, the real trace
 * store and a real IndexedDB through a sequence a user can perform, and asserts
 * what is observable after every step — including the step that must show the
 * precondition really was destroyed. Without that negative step, a later success
 * cannot distinguish "the fix worked" from "nothing was ever broken".
 *
 * Both platforms' captured connect sequences run every scenario, because the
 * console's job is to be right about whichever one it is pointed at.
 */

/** Retained rows, read from IndexedDB rather than from the hook's own state. */
async function retained(): Promise<number[]> {
  const rows = await getTracePage(1000)
  return rows.map((r) => r.seq).sort((a, b) => a - b)
}

/**
 * Drain the IDB promise chains a batch or a clear leaves behind, so an assertion
 * about what did *not* happen is made against a settled store. `waitFor` alone is
 * the wrong tool for that: it stops at the first moment the condition holds, which
 * is exactly the moment before a late write would undo it.
 */
async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
  })
}

let restoreEventSource: () => void

beforeEach(async () => {
  restoreEventSource = installFakeEventSource()
  await clearTraces()
})

afterEach(() => {
  restoreEventSource()
})

describe.each(PLATFORMS)('$name platform', ({ connect }) => {
  const dumped = tracesIn(connect)
  const dumpedSeqs = dumped.map((t) => t.seq).sort((a, b) => a - b)

  it('loads the connect dump into history, and replaying it does not duplicate', async () => {
    const { result } = renderHook(() => useConsoleUnderTest())

    // ① nothing retained yet — the rows that appear below can only come from the stream.
    expect(await retained()).toEqual([])

    // ② connect: the platform pushes what its ring buffer holds.
    await act(async () => {
      const es = FakeEventSource.current()
      es.emit('open')
      replay(es, connect)
    })
    await waitFor(async () => expect(await retained()).toEqual(dumpedSeqs))
    expect(result.current.store.rows).toHaveLength(dumped.length)

    // ③ the same dump again — a reconnect replays it, and it must not double up.
    await act(async () => {
      replay(FakeEventSource.current(), connect)
    })
    await waitFor(async () => expect(await countTraces()).toBe(dumped.length))
    expect(result.current.store.rows).toHaveLength(dumped.length)

    // ④ real traffic still accumulates on top.
    await act(async () => {
      FakeEventSource.current().emit('trace', traceFrame(9001, FIXTURE_NEWEST_EPOCH + 1_000))
    })
    await waitFor(async () => expect(await countTraces()).toBe(dumped.length + 1))
  })

  it('keeps history cleared when the platform replays its buffer afterwards', async () => {
    const { result } = renderHook(() => useConsoleUnderTest())

    await act(async () => {
      const es = FakeEventSource.current()
      es.emit('open')
      replay(es, connect)
    })
    await waitFor(async () => expect(await retained()).toEqual(dumpedSeqs))

    // ① clear, and prove it actually emptied the store — the assertions below are
    //    only meaningful against a store that was observed empty.
    await act(async () => {
      result.current.store.clear()
    })
    await settle()
    expect(await countTraces()).toBe(0)
    expect(result.current.store.rows).toEqual([])

    // ② the platform replays its buffer, which still holds every cleared trace.
    await act(async () => {
      replay(FakeEventSource.current(), connect)
    })
    await settle()
    expect(await countTraces()).toBe(0)
    expect(result.current.store.rows).toEqual([])

    // ③ traffic after the clear is kept — the clear must not deafen the store.
    await act(async () => {
      FakeEventSource.current().emit('trace', traceFrame(9002, FIXTURE_NEWEST_EPOCH + 2_000))
    })
    await waitFor(async () => expect(await retained()).toEqual([9002]))
  })

  it('leaves the live window alone when history is cleared', async () => {
    // Clearing retained history is not the same act as resetting the rolling
    // window the KPI row, latency chart and status mix read. The trace list drops
    // to nothing; those keep every trace the platform has sent.
    const { result } = renderHook(() => useConsoleUnderTest())

    await act(async () => {
      const es = FakeEventSource.current()
      es.emit('open')
      replay(es, connect)
    })
    await waitFor(() => expect(result.current.data?.traces).toHaveLength(dumped.length))

    await act(async () => {
      result.current.store.clear()
    })
    await settle()
    expect(await countTraces()).toBe(0)

    expect(result.current.data?.traces).toHaveLength(dumped.length)
    expect(result.current.store.rows).toEqual([])
  })

  it('stays empty when a clear lands on a batch whose write has not finished', async () => {
    // The store persists a batch asynchronously, so a click can arrive while the
    // write is still open. Its continuation must not repaint the emptied view with
    // rows the clear already deleted — a ghost that survives until the next reload,
    // since those rows are gone from storage.
    //
    // Whether the write is still open when the clear lands is not something this
    // test can force: IndexedDB decides. So it asserts the invariant instead — once
    // settled, a cleared store is empty either way — and catches the race on the
    // runs where the timing happens to line up. It cannot fail spuriously; it can
    // miss.
    const { result } = renderHook(() => useConsoleUnderTest())

    await act(async () => {
      const es = FakeEventSource.current()
      es.emit('open')
      replay(es, connect)
    })
    // Deliberately no wait for the write to land before clearing.
    await act(async () => {
      result.current.store.clear()
    })
    await settle()

    expect(await countTraces()).toBe(0)
    expect(result.current.store.rows).toEqual([])

    // Still listening: traffic after the clear lands normally.
    await act(async () => {
      FakeEventSource.current().emit('trace', traceFrame(9003, FIXTURE_NEWEST_EPOCH + 3_000))
    })
    await waitFor(async () => expect(await retained()).toEqual([9003]))
  })
})
