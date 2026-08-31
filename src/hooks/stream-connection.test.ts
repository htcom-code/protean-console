import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useConsoleData } from '@/hooks/use-console-data'
import { GO_CONNECT, PLATFORMS } from '@/test/stream-fixtures'
import { FakeEventSource, installFakeEventSource, replay } from '@/test/sse-stream'

/**
 * The connection state machine, driven by silence rather than by errors.
 *
 * `EventSource` cannot be trusted to fire `error` when a stream dies behind a dev
 * proxy — the client socket stays open and no listener ever runs — so the console
 * treats a gap in the 1Hz aggregate frames as the outage signal. That makes the
 * silence watchdog the only thing standing between a dead platform and a screen
 * that looks live, which is why it gets a scenario of its own.
 *
 * These run without IndexedDB: the state machine lives entirely in the stream
 * hook, and fake timers plus a real store fight each other for the event loop.
 */

let restoreEventSource: () => void

beforeEach(() => {
  restoreEventSource = installFakeEventSource()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  restoreEventSource()
})

describe.each(PLATFORMS)('$name platform', ({ connect }) => {
  it('goes live on the connect frames, reports the outage on silence, and recovers', () => {
    const { result } = renderHook(() => useConsoleData())
    expect(result.current.conn.status).toBe('initial')

    act(() => {
      const es = FakeEventSource.current()
      es.emit('open')
      replay(es, connect)
    })
    expect(result.current.conn.status).toBe('live')

    // ① silence past the watchdog window: the platform is gone, and saying so is
    //    the whole point — an unchanged 'live' badge here is the failure.
    act(() => {
      vi.advanceTimersByTime(6_500)
    })
    expect(result.current.conn.status).toBe('disconnected')

    // ② the hook rebuilds the stream on its own after the reconnect delay.
    const before = FakeEventSource.instances.length
    act(() => {
      vi.advanceTimersByTime(5_500)
    })
    expect(FakeEventSource.instances.length).toBe(before + 1)

    // ③ the platform answers again and the console returns to live.
    act(() => {
      replay(FakeEventSource.current(), connect)
    })
    expect(result.current.conn.status).toBe('live')
  })

  it('holds live while the platform keeps ticking', () => {
    const { result } = renderHook(() => useConsoleData())
    act(() => {
      const es = FakeEventSource.current()
      es.emit('open')
      replay(es, connect)
    })

    // Four windows' worth of time, but a frame every second — the watchdog must
    // not fire on a healthy stream.
    for (let i = 0; i < 24; i++) {
      act(() => {
        vi.advanceTimersByTime(1_000)
        FakeEventSource.current().emit('metrics', '[]')
      })
    }
    expect(result.current.conn.status).toBe('live')
  })
})

describe('cold start', () => {
  it('falls back to sample data when no platform ever answers', () => {
    const { result } = renderHook(() => useConsoleData())

    // Before the fallback delay there is nothing to show and nothing to claim.
    act(() => {
      vi.advanceTimersByTime(1_000)
    })
    expect(result.current.conn.status).toBe('initial')
    expect(result.current.data).toBeNull()

    act(() => {
      vi.advanceTimersByTime(2_000)
    })
    expect(result.current.conn.status).toBe('sample')
    expect(result.current.data?.traces.length).toBeGreaterThan(0)
  })

  it('never shows sample data once a platform has answered', () => {
    const { result } = renderHook(() => useConsoleData())
    act(() => {
      const es = FakeEventSource.current()
      es.emit('open')
      replay(es, GO_CONNECT)
    })
    act(() => {
      vi.advanceTimersByTime(30_000)
    })
    // Whatever else happened, the console must not have quietly swapped a dead
    // platform's last real data for the demo fixture.
    expect(result.current.conn.status).not.toBe('sample')
  })
})
