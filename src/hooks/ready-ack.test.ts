import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useConsoleData } from '@/hooks/use-console-data'
import { GO_CONNECT, PROTEAN_CONNECT, SPRING_CONNECT } from '@/test/stream-fixtures'
import { FakeEventSource, installFakeEventSource, replay } from '@/test/sse-stream'

/**
 * The connection ack (`event: ready`).
 *
 * It is the one frame that arrives on a platform serving no traffic, and it is
 * the only place the console learns four things it used to assume, invent, or
 * infer: the push period its watchdog is sized against, the ring size its badge
 * prints, whether metrics are recording, and which implementation answered.
 *
 * Every assumption it replaces is asserted here in both directions — the value
 * the platform states, and the honest blank for a platform that states nothing.
 * A console that quietly falls back to its old guesses would pass a test that
 * only checked the first.
 */

/** An ack with the fields a case cares about, on a platform-shaped default. */
function ready(fields: Record<string, unknown> = {}): string {
  return JSON.stringify({
    platform: 'protean',
    platformVersion: '0.1.0',
    tracesEnabled: true,
    metricsEnabled: false,
    buffered: 0,
    tickMs: 1000,
    capacity: 200,
    ...fields,
  })
}

let restoreEventSource: () => void

beforeEach(() => {
  restoreEventSource = installFakeEventSource()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  restoreEventSource()
})

describe('the ack on a quiet platform', () => {
  it('is enough to report the stream live', () => {
    // The whole reason the frame exists: a platform with no traffic sends no
    // `trace` frames, so without the ack "the socket opened" and "the platform is
    // running" are the same observation. The console must take the ack as the
    // second one.
    const { result } = renderHook(() => useConsoleData())
    act(() => {
      const es = FakeEventSource.current()
      es.emit('open')
      es.emit('ready', ready({ buffered: 0 }))
    })
    expect(result.current.conn.status).toBe('live')
  })

  it('carries the connect-time facts onto the screen', () => {
    const { result } = renderHook(() => useConsoleData())
    act(() => {
      const es = FakeEventSource.current()
      es.emit('open')
      replay(es, PROTEAN_CONNECT)
    })
    expect(result.current.platform).toEqual({
      platform: 'protean',
      platformVersion: '0.1.0-SNAPSHOT', // the captured build; printed, never compared
      tracesEnabled: true,
      metricsEnabled: false,
      buffered: 5, // equal to the rows of the `trace` frame behind it, as captured
      tickMs: 1000,
      capacity: 200,
    })
  })
})

describe('a platform that sends no ack', () => {
  /**
   * Older platforms, and the other implementations of this contract that have not
   * adopted the frame yet. They must keep working exactly as before — and the
   * console must not fill the gap with numbers nobody gave it.
   */
  it.each([
    ['spring', SPRING_CONNECT],
    ['go', GO_CONNECT],
  ])('stays live on %s and claims nothing about it', (_name, connect) => {
    const { result } = renderHook(() => useConsoleData())
    act(() => {
      const es = FakeEventSource.current()
      es.emit('open')
      replay(es, connect)
    })
    expect(result.current.conn.status).toBe('live')
    expect(result.current.platform).toBeNull()
  })

  it('is still judged by the assumed period', () => {
    // The 6s window predates the ack and remains the fallback. A platform that
    // states nothing must not become un-watchable.
    const { result } = renderHook(() => useConsoleData())
    act(() => {
      const es = FakeEventSource.current()
      es.emit('open')
      replay(es, GO_CONNECT)
    })
    act(() => {
      vi.advanceTimersByTime(6_500)
    })
    expect(result.current.conn.status).toBe('disconnected')
  })
})

describe('the watchdog sizes itself from the stated period', () => {
  /**
   * The window used to be six seconds because the platform was assumed to push
   * once a second. `tickMs` turns that assumption into a contract — and the test
   * that matters is the slow platform, because that is the one the old constant
   * declared dead while it was working perfectly.
   */
  function connectWith(tickMs: number) {
    const hook = renderHook(() => useConsoleData())
    act(() => {
      const es = FakeEventSource.current()
      es.emit('open')
      es.emit('ready', ready({ tickMs }))
    })
    return hook
  }

  it('holds live through a gap that would kill a 1Hz platform', () => {
    const { result } = connectWith(3_000) // 6 ticks = 18s
    act(() => {
      vi.advanceTimersByTime(10_000) // well past the 6s default, well inside 18s
    })
    expect(result.current.conn.status).toBe('live')
  })

  it('still reports the outage once the stated window passes', () => {
    // The other direction: a wider window is not an excuse to stop watching.
    const { result } = connectWith(3_000)
    act(() => {
      vi.advanceTimersByTime(18_500)
    })
    expect(result.current.conn.status).toBe('disconnected')
  })

  it('reports a fast platform sooner than the old constant would', () => {
    const { result } = connectWith(400) // 6 ticks = 2.4s
    act(() => {
      vi.advanceTimersByTime(2_600)
    })
    expect(result.current.conn.status).toBe('disconnected')
  })

  it('refuses a period that would make the watchdog useless at either end', () => {
    // A stated period is a contract, not a free hand: a few milliseconds would
    // trip on scheduler jitter, an hour would never trip at all. Both are clamped.
    const fast = connectWith(1) // 6ms → floored to 2s
    act(() => {
      vi.advanceTimersByTime(1_500)
    })
    expect(fast.result.current.conn.status, 'floor not applied').toBe('live')
    act(() => {
      vi.advanceTimersByTime(1_000)
    })
    expect(fast.result.current.conn.status).toBe('disconnected')
    fast.unmount()

    const slow = connectWith(3_600_000) // 6 hours → capped at 60s
    act(() => {
      vi.advanceTimersByTime(61_000)
    })
    expect(slow.result.current.conn.status, 'ceiling not applied').toBe('disconnected')
  })
})

describe('an ack the console cannot read', () => {
  it('is counted as a bad frame and invents nothing', () => {
    const { result } = renderHook(() => useConsoleData())
    act(() => {
      const es = FakeEventSource.current()
      es.emit('open')
      es.emit('ready', '[]') // an array where the contract says object
      replay(es, SPRING_CONNECT)
    })
    expect(result.current.platform).toBeNull()
    expect(result.current.channels.ready.total).toBe(1)
    expect(result.current.conn.status).toBe('live') // the data frames still arrived
  })

  it('keeps the fields it can read when one of them is the wrong type', () => {
    // The ack is extensible by design, so a value this console cannot read is
    // "not stated", not a reason to throw away the six values it can read.
    const { result } = renderHook(() => useConsoleData())
    act(() => {
      const es = FakeEventSource.current()
      es.emit('open')
      es.emit('ready', ready({ tickMs: 'fast', somethingNewer: { added: 'later' } }))
    })
    expect(result.current.platform?.capacity).toBe(200)
    expect(result.current.platform?.tickMs).toBeNull()

    // And an unreadable period falls back to the assumed one rather than to no
    // watchdog at all.
    act(() => {
      vi.advanceTimersByTime(6_500)
    })
    expect(result.current.conn.status).toBe('disconnected')
  })

  it('reports a missing version as unknown rather than as a version', () => {
    // A platform whose classes carry no version manifest genuinely does not know
    // its own version — protean's own test suite runs that way, and so does any
    // consumer that repackages it into an uber-jar without preserving the
    // manifest. `null` is the platform's answer, and the console keeps it as one.
    const { result } = renderHook(() => useConsoleData())
    act(() => {
      const es = FakeEventSource.current()
      es.emit('open')
      es.emit('ready', ready({ platformVersion: null }))
    })
    expect(result.current.platform?.platform).toBe('protean')
    expect(result.current.platform?.platformVersion).toBeNull()
  })
})

describe('the facts belong to the connection that stated them', () => {
  /**
   * `capacity`, `tracesEnabled` and `metricsEnabled` are live settings on the
   * platform, and the ack is the only time the console is told them. Carrying a
   * dead connection's answers into the next one would put a claim on screen that
   * nothing has made — and the platform answering now may not even be the one
   * that answered before.
   */
  it('drops them when the stream is rebuilt and re-learns them from the next ack', () => {
    const { result } = renderHook(() => useConsoleData())
    act(() => {
      const es = FakeEventSource.current()
      es.emit('open')
      es.emit('ready', ready({ capacity: 200 }))
    })
    expect(result.current.platform?.capacity).toBe(200)

    // The platform goes quiet and the hook rebuilds the stream.
    act(() => {
      vi.advanceTimersByTime(6_500)
    })
    act(() => {
      vi.advanceTimersByTime(5_500)
    })
    expect(result.current.platform, 'last connection’s facts outlived it').toBeNull()

    act(() => {
      const es = FakeEventSource.current()
      es.emit('open')
      es.emit('ready', ready({ capacity: 5_000, metricsEnabled: true }))
    })
    expect(result.current.platform?.capacity).toBe(5_000)
    expect(result.current.platform?.metricsEnabled).toBe(true)
  })
})
