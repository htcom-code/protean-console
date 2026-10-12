import { act, cleanup, render, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { KpiRow } from '@/components/kpi-row'
import { LatencyChart } from '@/components/latency-chart'
import { StatusMix } from '@/components/status-mix'
import { useConsoleData } from '@/hooks/use-console-data'
import { appendPoint, RANGE_MS, segments, SERIES_SPAN_MS, type LatencyPoint } from '@/lib/latency-series'
import { mockLatencySeries } from '@/lib/mock'
import { DEFAULT_SETTINGS } from '@/lib/settings'
import type { ModuleMetricsSnapshot, RequestTrace, TraceSummary } from '@/lib/types'
import { PLATFORMS, PROTEAN_CONNECT, traceFrame } from '@/test/stream-fixtures'
import { FakeEventSource, installFakeEventSource, parseStream, replay } from '@/test/sse-stream'

/**
 * The latency chart plots the platform's windowed p95 — one point per `summary`
 * frame received on this page — on a time axis that ends now.
 *
 * It used to bucket the in-memory trace window (500 rows) per minute. The time
 * those rows covered shrank with load, and during a 4,000-request burst the chart
 * was a single dot. The scenarios below pin the replacement against the same
 * failure: traffic of any size must not shrink the chart, the connect dump must
 * not reach it, and silence must look like silence.
 */

/** Chart geometry, mirrored from latency-chart.tsx. */
const W = 720
const PAD_L = 30
const PAD_R = 10
const PLOT_W = W - PAD_L - PAD_R

const T0 = 1_790_000_000_000

/** A run of points `tickMs` apart, starting at `from`. */
function run(from: number, count: number, tickMs = 1000, p95 = 20): LatencyPoint[] {
  return Array.from({ length: count }, (_, i) => ({ at: from + i * tickMs, p95: p95 + i, tickMs }))
}

/** The summary frame a fixture carries, as the platform sent it. */
function summaryOf(connect: string): TraceSummary {
  return JSON.parse(parseStream(connect).find((f) => f.event === 'summary')!.data) as TraceSummary
}

function summaryFrame(p95: number): string {
  return JSON.stringify({ ...summaryOf(PROTEAN_CONNECT), p95LatencyMs: p95 })
}

function lines(container: HTMLElement): number {
  return container.querySelectorAll('polyline').length
}

function newestX(container: HTMLElement): number {
  return Number(container.querySelector('circle[data-newest]')!.getAttribute('cx'))
}

afterEach(cleanup)

describe.each(PLATFORMS)('on connect to $name', ({ connect, newestEpoch }) => {
  let restoreEventSource: () => void
  beforeEach(() => {
    restoreEventSource = installFakeEventSource()
    // Seconds after the dump's newest trace, so its rows sit well inside the span
    // the series holds: if they reached it, nothing would age them out first.
    vi.useFakeTimers()
    vi.setSystemTime(newestEpoch + 2_000)
  })
  afterEach(() => {
    vi.useRealTimers()
    restoreEventSource()
  })

  it('plots the summary the platform sent, and nothing from the trace dump', () => {
    // The dump is seconds of traffic from before this page connected. It used to
    // become the chart's first points, drawn under "over time"; now only the
    // windowed p95 the platform reports does.
    const { result } = renderHook(() => useConsoleData())
    act(() => {
      const es = FakeEventSource.current()
      es.emit('open')
      replay(es, connect)
    })
    const latency = result.current.data!.latency
    expect(latency).toHaveLength(1)
    expect(latency[0].p95).toBe(summaryOf(connect).p95LatencyMs)
  })
})

describe('the series the stream builds', () => {
  let restoreEventSource: () => void
  beforeEach(() => {
    restoreEventSource = installFakeEventSource()
    vi.useFakeTimers()
    vi.setSystemTime(T0)
  })
  afterEach(() => {
    vi.useRealTimers()
    restoreEventSource()
  })

  function connected() {
    const hook = renderHook(() => useConsoleData())
    act(() => {
      const es = FakeEventSource.current()
      es.emit('open')
      replay(es, PROTEAN_CONNECT)
    })
    return hook
  }

  /** One platform tick: a second passes and a summary arrives. */
  function tick(p95: number) {
    act(() => {
      vi.advanceTimersByTime(1000)
      FakeEventSource.current().emit('summary', summaryFrame(p95))
    })
  }

  it('stays a line through a burst that used to collapse it to a dot', () => {
    // 🔴 The failure this replaces: 600 traces inside one second filled the
    // 500-row window with a single minute, and the chart drew one dot.
    const { result } = connected()
    for (let s = 1; s <= 5; s++) {
      act(() => {
        const es = FakeEventSource.current()
        for (let i = 0; i < 120; i++) es.emit('trace', traceFrame(s * 1000 + i, T0 + s * 1000 + i))
      })
      tick(10 + s)
    }
    const latency = result.current.data!.latency
    expect(latency).toHaveLength(6) // the connect summary + one per tick, whatever the traffic

    const { container } = render(<LatencyChart points={latency} range="15m" now={Date.now()} />)
    expect(lines(container)).toBe(1)
    expect(container.querySelector('polyline')!.getAttribute('points')!.trim().split(/\s+/)).toHaveLength(6)
  })

  it('stamps each point with the tick the platform stated', () => {
    const { result } = renderHook(() => useConsoleData())
    act(() => {
      const es = FakeEventSource.current()
      es.emit('open')
      es.emit('ready', JSON.stringify({ platform: 'protean', tickMs: 5000, capacity: 200 }))
      es.emit('summary', summaryFrame(7))
    })
    expect(result.current.data!.latency[0].tickMs).toBe(5000)
  })

  it('falls back to the assumed 1 Hz for a platform that states no tick', () => {
    const { result } = renderHook(() => useConsoleData())
    act(() => {
      const es = FakeEventSource.current()
      es.emit('open')
      es.emit('summary', summaryFrame(7))
    })
    expect(result.current.data!.latency[0].tickMs).toBe(1000)
  })

  it('adds no point for a p95 that is not a number', () => {
    const { result } = connected()
    act(() => {
      FakeEventSource.current().emit('summary', JSON.stringify({ ...summaryOf(PROTEAN_CONNECT), p95LatencyMs: 'n/a' }))
    })
    expect(result.current.data!.latency).toHaveLength(1)
  })

  it('keeps the series across a reconnect, with the outage as a break', () => {
    // Page-scoped, not connection-scoped: a dropped stream must not start the
    // chart over, and the time it was gone must not be joined up.
    const { result } = connected()
    tick(4)
    tick(5)
    act(() => {
      vi.advanceTimersByTime(6_000) // silence past the 6 s window: the watchdog drops the stream
    })
    act(() => {
      vi.advanceTimersByTime(5_000) // and rebuilds it after the reconnect delay
    })
    act(() => {
      const es = FakeEventSource.current()
      es.emit('open')
      replay(es, PROTEAN_CONNECT)
    })
    tick(6)

    const latency = result.current.data!.latency
    expect(latency).toHaveLength(5)
    expect(segments(latency).map((r) => r.length)).toEqual([3, 2])
  })
})

describe('the time axis', () => {
  it('ends at now, so the newest point sits on the right edge while data flows', () => {
    const points = run(T0, 10)
    const { container } = render(<LatencyChart points={points} range="15m" now={T0 + 9_000} />)
    expect(newestX(container)).toBeCloseTo(W - PAD_R)
  })

  it('slides the line left when the stream goes quiet', () => {
    // 🔴 Anchored to the last point, a frozen chart looks exactly like a live one.
    const points = run(T0, 10)
    const quiet = 5 * 60_000
    const { container } = render(<LatencyChart points={points} range="15m" now={T0 + 9_000 + quiet} />)
    const expected = PAD_L + ((RANGE_MS['15m'] - quiet) / RANGE_MS['15m']) * PLOT_W
    expect(newestX(container)).toBeCloseTo(expected)
  })

  it('goes back to the empty frame once everything has aged out of the range', () => {
    const points = run(T0, 10)
    const { container, getByText } = render(
      <LatencyChart points={points} range="15m" now={T0 + RANGE_MS['15m'] + 60_000} />,
    )
    expect(getByText('No samples in this window yet')).toBeTruthy()
    expect(container.querySelector('polyline')).toBeNull()
  })

  it('draws only what exists before the range has filled', () => {
    // Connected for a minute with a 15-minute range: the line covers the right
    // fifteenth and the rest stays empty, which is what says how much there is.
    const points = run(T0, 61)
    const { container } = render(<LatencyChart points={points} range="15m" now={T0 + 60_000} />)
    const xs = container
      .querySelector('polyline')!
      .getAttribute('points')!
      .trim()
      .split(/\s+/)
      .map((p) => Number(p.split(',')[0]))
    expect(Math.min(...xs)).toBeCloseTo(PAD_L + (14 / 15) * PLOT_W)
    expect(Math.max(...xs)).toBeCloseTo(W - PAD_R)
  })

  it('shows more of what it holds when the range is widened', () => {
    // An hour of points: a 15-minute range shows the last quarter of them, an
    // hour shows them all — nothing was thrown away by the narrower choice.
    const points = run(T0, 3600)
    const now = T0 + 3599_000
    const count = (range: '15m' | '1h') => {
      const { container, unmount } = render(<LatencyChart points={points} range={range} now={now} />)
      const n = container.querySelector('polyline')!.getAttribute('points')!.trim().split(/\s+/).length
      unmount()
      return n
    }
    expect(count('15m')).toBe(901)
    expect(count('1h')).toBe(3600)
  })

  it('names the range on the axis', () => {
    const { getByText } = render(<LatencyChart points={run(T0, 3)} range="1h" now={T0 + 2_000} />)
    expect(getByText('−1h')).toBeTruthy()
    expect(getByText('now')).toBeTruthy()
  })
})

describe('gaps', () => {
  it('breaks the line where points are further apart than two ticks', () => {
    const points = [...run(T0, 5), ...run(T0 + 30_000, 5)]
    const { container } = render(<LatencyChart points={points} range="15m" now={T0 + 34_000} />)
    expect(lines(container)).toBe(2)
  })

  it('does not break it for a frame that is merely late', () => {
    // 1.9 s apart on a 1 s tick is jitter, not an outage.
    const points = [...run(T0, 5), ...run(T0 + 5_900, 5)]
    const { container } = render(<LatencyChart points={points} range="15m" now={T0 + 9_900} />)
    expect(lines(container)).toBe(1)
  })

  it('judges the gap by the tick each point was promised', () => {
    // A 5 s platform: 8 s between frames is within two of its ticks.
    expect(segments([...run(T0, 3, 5000), ...run(T0 + 18_000, 3, 5000)])).toHaveLength(1)
    expect(segments([...run(T0, 3, 1000), ...run(T0 + 10_000, 3, 1000)])).toHaveLength(2)
  })

  it('draws a lone point between two gaps as a dot, not a ramp', () => {
    const points = [...run(T0, 3), { at: T0 + 20_000, p95: 9, tickMs: 1000 }, ...run(T0 + 40_000, 3)]
    const { container } = render(<LatencyChart points={points} range="15m" now={T0 + 42_000} />)
    expect(lines(container)).toBe(2)
    expect(container.querySelectorAll('polygon')).toHaveLength(2)
  })
})

describe('the held series', () => {
  it('keeps six hours whatever range is selected, and no more', () => {
    let series: LatencyPoint[] = []
    const first = { at: T0, p95: 1, tickMs: 1000 }
    series = appendPoint(series, first)
    series = appendPoint(series, { at: T0 + SERIES_SPAN_MS, p95: 2, tickMs: 1000 })
    expect(series).toContain(first) // exactly six hours old: still held
    series = appendPoint(series, { at: T0 + SERIES_SPAN_MS + 1, p95: 3, tickMs: 1000 })
    expect(series).not.toContain(first)
    expect(series).toHaveLength(2)
  })

  it('defaults to a 15-minute range', () => {
    expect(DEFAULT_SETTINGS.chartRange).toBe('15m')
  })
})

describe('what the header says', () => {
  it('names the window each point is a p95 of, and the cap on its sample', () => {
    // Each point is smoothed over the platform's window and, under load, drawn
    // from at most `capacity` traces. Both change how the curve should be read.
    const { getByText } = render(
      <LatencyChart points={run(T0, 3)} range="15m" now={T0 + 2_000} windowMs={60_000} capacity={200} />,
    )
    expect(getByText('ms · p95 of 60s · ≤200 traces')).toBeTruthy()
  })

  it('leaves out what the platform did not state', () => {
    const { getByText } = render(<LatencyChart points={run(T0, 3)} range="15m" now={T0 + 2_000} windowMs={60_000} />)
    expect(getByText('ms · p95 of 60s')).toBeTruthy()
  })
})

describe('latency chart with no samples', () => {
  /**
   * An idle platform is the normal state of a console someone just opened, and the
   * card used to vanish on it — taking half of the row it shares with the status
   * mix and leaving a layout that looked broken rather than quiet.
   *
   * The frame is drawn instead. What must not appear with it is a shape: a line,
   * an area or a point would all be data this console never received.
   */
  it('draws the frame but nothing to read as data', () => {
    const { container } = render(<LatencyChart points={[]} range="15m" now={T0} />)
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg!.querySelector('polyline')).toBeNull()
    expect(svg!.querySelector('polygon')).toBeNull()
    expect(svg!.querySelector('circle'), 'marked a sample that does not exist').toBeNull()
  })

  it('says the scale is a default rather than a measurement', () => {
    const { getByText } = render(<LatencyChart points={[]} range="15m" now={T0} />)
    expect(getByText(/default scale/)).toBeTruthy()
    expect(getByText('No samples in this window yet')).toBeTruthy()
  })

  it('goes back to the measured scale as soon as a sample lands', () => {
    const { container, queryByText, rerender } = render(<LatencyChart points={[]} range="15m" now={T0} />)
    rerender(<LatencyChart points={run(T0, 2)} range="15m" now={T0 + 1_000} windowMs={60_000} />)
    expect(queryByText(/default scale/)).toBeNull()
    expect(container.querySelector('polyline')).not.toBeNull()
  })
})

describe('latency chart on sample data', () => {
  /**
   * With no platform the console draws a generated curve. The top bar says SAMPLE
   * DATA, and the chart's header says it too: a generated curve is not a window
   * onto anything.
   */
  it('says the curve is sample data', () => {
    const { getByText, getByRole } = render(<LatencyChart points={mockLatencySeries(T0)} range="15m" sample />)
    expect(getByText(/sample data/)).toBeTruthy()
    expect(getByRole('img').getAttribute('aria-label')).toMatch(/sample data/)
  })

  it('fills every range, and stays put rather than sliding away with the clock', () => {
    // Generated long before "now": anchored to the clock it would have slid out of
    // view and left the demo empty.
    for (const range of ['5m', '6h'] as const) {
      const { container, unmount } = render(<LatencyChart points={mockLatencySeries(T0)} range={range} sample />)
      expect(lines(container)).toBe(1)
      expect(newestX(container)).toBeCloseTo(W - PAD_R)
      const first = Number(container.querySelector('polyline')!.getAttribute('points')!.split(',')[0])
      expect(first).toBeCloseTo(PAD_L)
      unmount()
    }
  })

  it('agrees with the p95 tile, as a live platform would', () => {
    // On a platform the tile and the chart's newest point are one number. The demo
    // used to print 88 ms on the tile beside a curve ending in the 40s — sample
    // data, but a false lesson about what the two panels mean.
    const restoreEventSource = installFakeEventSource()
    vi.useFakeTimers()
    try {
      const { result } = renderHook(() => useConsoleData({ sampleDelayMs: 500 }))
      act(() => {
        vi.advanceTimersByTime(600) // no platform answered: the demo takes over
      })
      expect(result.current.conn.status).toBe('sample')
      const { latency, summary } = result.current.data!
      const newest = latency[latency.length - 1]
      const windowBack = latency.findLast((p) => p.at <= newest.at - summary!.windowMs)!
      expect(summary!.p95LatencyMs).toBe(newest.p95)
      expect(summary!.p95DeltaMs).toBe(newest.p95 - windowBack.p95)

      const { getByText } = render(<KpiRow metrics={result.current.data!.metrics} summary={summary} />)
      expect(getByText(String(newest.p95))).toBeTruthy()
    } finally {
      vi.useRealTimers()
      restoreEventSource()
    }
  })

  it('drops the label once real samples replace it', () => {
    const { queryByText, rerender } = render(<LatencyChart points={mockLatencySeries(T0)} range="15m" sample />)
    rerender(<LatencyChart points={run(T0, 2)} range="15m" now={T0 + 1_000} />)
    expect(queryByText(/sample data/)).toBeNull()
  })
})

describe('the p95 tile', () => {
  const metrics: ModuleMetricsSnapshot[] = [
    {
      moduleId: 'slow',
      count: 10,
      errorCount: 0,
      errorRate: 0,
      p50LatencyMs: 400,
      p95LatencyMs: 900,
      p99LatencyMs: 950,
      maxLatencyMs: 990,
      lastSeenEpochMillis: T0,
    },
  ]

  it('shows the windowed p95 the chart plots, not the worst module', () => {
    // The tile used to print the worst per-module p95 (900 here) beside a chart
    // that plotted something else; now it reads as the chart's newest point.
    const { getByText, queryByText } = render(<KpiRow metrics={metrics} summary={summaryOf(PROTEAN_CONNECT)} />)
    expect(getByText('3')).toBeTruthy()
    expect(queryByText('900')).toBeNull()
  })

  it('shows a dash until a summary arrives, rather than a different measurement', () => {
    const { getAllByText, queryByText } = render(<KpiRow metrics={metrics} summary={null} />)
    expect(queryByText('900')).toBeNull()
    expect(getAllByText('—').length).toBeGreaterThan(0)
    expect(queryByText('no summary yet')).toBeTruthy()
  })
})

describe('status mix', () => {
  /**
   * The header count and the bar geometry were one number, and the `|| 1` that
   * keeps a width from dividing by zero was also what the header printed: an idle
   * platform read "1 req" beside four zeroes, which is a request that never
   * happened.
   */
  it('counts no requests as none', () => {
    const { getByText } = render(<StatusMix traces={[]} />)
    expect(getByText('0 req')).toBeTruthy()
  })

  it('says the count is of the latest requests, not of all traffic', () => {
    const t = (status: number, seq: number): RequestTrace => ({
      seq,
      epochMillis: 1789971324000 + seq,
      method: 'GET',
      uri: '/x',
      pattern: null,
      moduleId: null,
      status,
      latencyMs: 1,
      error: null,
      traceId: `dddd${seq}`,
    })
    const { getByText } = render(<StatusMix traces={[t(200, 1), t(404, 2), t(500, 3)]} />)
    expect(getByText('last 3 req')).toBeTruthy()
  })
})
