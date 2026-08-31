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

describe('a platform that stops answering entirely', () => {
  /**
   * The failure the silence watchdog exists for, in its harshest form: the stream
   * is gone and every attempt to rebuild it is refused. No frame ever arrives
   * again, so nothing but the watchdog can notice — and the operator has to be
   * told, because a console that still says LIVE over a dead platform is worse
   * than one that says nothing at all.
   *
   * Rebuilding is the hook's own doing (`reconnect` → `open`), and `open` re-arms
   * the watchdog. So this is also the scenario that asks whether the retry loop
   * can keep pushing the deadline it is supposed to trip.
   */
  it('reports the outage instead of holding LIVE while every reconnect is refused', () => {
    const { result } = renderHook(() => useConsoleData())

    act(() => {
      const es = FakeEventSource.current()
      es.emit('open')
      replay(es, GO_CONNECT)
    })
    expect(result.current.conn.status).toBe('live')

    // The platform disappears. Each rebuilt stream is refused at once, which is
    // what a browser reports when the port stops listening.
    let elapsed = 0
    for (let i = 0; i < 12 && result.current.conn.status === 'live'; i++) {
      act(() => {
        FakeEventSource.current().emit('error')
      })
      act(() => {
        vi.advanceTimersByTime(5_100) // RECONNECT_DELAY_MS, then `open` runs
        elapsed += 5_100
      })
    }

    expect(result.current.conn.status, `still LIVE after ${elapsed}ms of refused reconnects`).toBe('disconnected')
  })

  it('reports the outage when the stream dies without ever raising an error', () => {
    // The case the watchdog was written for: a dev proxy holds the client socket
    // open after the upstream is gone, so `error` never fires and only the gap in
    // the 1Hz frames gives it away.
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

  it('reports the outage again after a reconnect that succeeds and then dies', () => {
    // Recovery must not spend the watchdog. A stream that comes back and drops
    // again has to be reported the second time too, or the console is honest
    // exactly once per page load.
    const { result } = renderHook(() => useConsoleData())
    act(() => {
      const es = FakeEventSource.current()
      es.emit('open')
      replay(es, GO_CONNECT)
    })

    for (let cycle = 0; cycle < 2; cycle++) {
      act(() => {
        vi.advanceTimersByTime(6_500) // dies quietly
      })
      expect(result.current.conn.status, `cycle ${cycle}: outage not reported`).toBe('disconnected')

      act(() => {
        vi.advanceTimersByTime(5_100) // the hook rebuilds the stream
      })
      act(() => {
        replay(FakeEventSource.current(), GO_CONNECT) // and the platform answers
      })
      expect(result.current.conn.status, `cycle ${cycle}: recovery not reported`).toBe('live')
    }
  })

  it('recovers when the platform comes back', () => {
    const { result } = renderHook(() => useConsoleData())
    act(() => {
      const es = FakeEventSource.current()
      es.emit('open')
      replay(es, GO_CONNECT)
    })

    // Long enough to be reported as an outage under any tolerance.
    for (let i = 0; i < 12; i++) {
      act(() => {
        FakeEventSource.current().emit('error')
      })
      act(() => {
        vi.advanceTimersByTime(5_100)
      })
    }
    act(() => {
      replay(FakeEventSource.current(), GO_CONNECT)
    })
    expect(result.current.conn.status).toBe('live')
  })
})

describe('a platform that talks but cannot be understood', () => {
  /**
   * The stream is open, frames keep arriving on time, and not one of them can be
   * read. The data is as stale as it would be in an outage, but the cause is not
   * an outage — and the two call for different words and different actions. Saying
   * "unreachable" about a platform that is answering is a false statement to the
   * operator, and rebuilding the stream only fetches the same unreadable frames.
   */
  const malformedTick = (es: FakeEventSource) => {
    es.emit('modules', '{"swapped":"greeter","version":"2"}')
    es.emit('metrics', '{"metrics":[]}')
    es.emit('summary', '[]')
  }

  it('does not call a talking platform unreachable', () => {
    const { result } = renderHook(() => useConsoleData())
    act(() => {
      const es = FakeEventSource.current()
      es.emit('open')
      replay(es, GO_CONNECT)
    })

    for (let i = 0; i < 10; i++) {
      act(() => {
        vi.advanceTimersByTime(1_000)
        malformedTick(FakeEventSource.current())
      })
    }

    expect(result.current.conn.status).toBe('unreadable')
    // Every channel it sent is marked, so the panels can say which data is frozen.
    expect(result.current.channels.modules.stale).toBe(true)
    expect(result.current.channels.metrics.stale).toBe(true)
    expect(result.current.channels.summary.stale).toBe(true)
  })

  it('keeps the stream it already has', () => {
    // Tearing it down buys nothing: the platform would send the same frames to the
    // next one, and the rebuild loop would run forever against a live platform.
    const { result } = renderHook(() => useConsoleData())
    act(() => {
      const es = FakeEventSource.current()
      es.emit('open')
      replay(es, GO_CONNECT)
    })
    const built = FakeEventSource.instances.length

    for (let i = 0; i < 20; i++) {
      act(() => {
        vi.advanceTimersByTime(1_000)
        malformedTick(FakeEventSource.current())
      })
    }

    expect(result.current.conn.status).toBe('unreadable')
    expect(FakeEventSource.instances.length, 'the stream was rebuilt while it was still delivering').toBe(built)
    expect(FakeEventSource.instances.filter((es) => !es.closed)).toHaveLength(1)
  })

  it('reports the outage once a talking platform goes quiet', () => {
    // Unreadable is not a resting place. If the frames stop too, that is an outage
    // and has to be reported as one.
    const { result } = renderHook(() => useConsoleData())
    act(() => {
      const es = FakeEventSource.current()
      es.emit('open')
      replay(es, GO_CONNECT)
    })
    for (let i = 0; i < 8; i++) {
      act(() => {
        vi.advanceTimersByTime(1_000)
        malformedTick(FakeEventSource.current())
      })
    }
    expect(result.current.conn.status).toBe('unreadable')

    act(() => {
      vi.advanceTimersByTime(7_000) // nothing at all now
    })
    expect(result.current.conn.status).toBe('disconnected')
  })

  it('returns to live when the platform starts making sense again', () => {
    const { result } = renderHook(() => useConsoleData())
    act(() => {
      const es = FakeEventSource.current()
      es.emit('open')
      replay(es, GO_CONNECT)
    })
    for (let i = 0; i < 8; i++) {
      act(() => {
        vi.advanceTimersByTime(1_000)
        malformedTick(FakeEventSource.current())
      })
    }
    expect(result.current.conn.status).toBe('unreadable')

    act(() => {
      replay(FakeEventSource.current(), GO_CONNECT)
    })
    expect(result.current.conn.status).toBe('live')
    expect(result.current.channels.modules.stale).toBe(false)
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

  it('falls back to sample data even while every connect attempt is refused', () => {
    // A cold start against a platform that is simply not there. The refused
    // attempts must not keep the console on the connecting spinner: with nothing
    // ever delivered there is no real data to protect, so the explorable sample
    // is the honest thing to show — and `disconnected` would claim we had once
    // been connected.
    const { result } = renderHook(() => useConsoleData())

    for (let i = 0; i < 3; i++) {
      act(() => {
        FakeEventSource.current().emit('error')
      })
      act(() => {
        vi.advanceTimersByTime(5_100)
      })
    }
    expect(result.current.conn.status).toBe('sample')
    expect(result.current.data?.traces.length).toBeGreaterThan(0)
  })

  it('does not call a cold start an outage', () => {
    // Nothing has ever arrived, so there is nothing to have lost. Reporting
    // `disconnected` here would claim a connection the console never had, and the
    // banner would tell the operator the platform went down when it may simply
    // not be running yet. The watchdog does come due — this asserts what it must
    // not conclude when it does.
    const { result } = renderHook(() => useConsoleData())

    act(() => {
      vi.advanceTimersByTime(7_000) // past both the sample delay and the watchdog
    })
    expect(result.current.conn.status).toBe('sample')
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
