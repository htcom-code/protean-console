import type { TimeRange } from '@/lib/types'

/**
 * The latency chart's data: the platform's windowed p95, one point per `summary`
 * frame received on this page.
 *
 * It used to be derived from the in-memory trace window, bucketed per minute. That
 * window is 500 rows, so the time it covered shrank with load: at 67 req/s it was
 * 7.5 seconds, one bucket, and the chart was a dot exactly when an operator needed
 * it. A burst cannot shrink this series — it grows by one point per platform tick,
 * whatever the traffic.
 *
 * Only what arrived after this page connected is here. The trace dump a platform
 * sends on connect is seconds of traffic from before the connection, and it no
 * longer reaches the chart; a reload starts the series empty.
 */
export interface LatencyPoint {
  /** When the frame arrived, on this browser's clock. `summary` carries no time of its own. */
  at: number
  /** `summary.p95LatencyMs` — the p95 over the platform's `windowMs`, not over the tick. */
  p95: number
  /**
   * The push period of the connection that delivered it. Kept per point because a
   * rebuilt stream may reach a platform with a different tick, and a gap is judged
   * against the period that was promised at the time.
   */
  tickMs: number
}

export const TIME_RANGES: readonly TimeRange[] = ['5m', '15m', '1h', '6h']

export const RANGE_MS: Record<TimeRange, number> = {
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
  '6h': 6 * 60 * 60_000,
}

/**
 * How much history the page holds, whatever range is selected. Holding only the
 * selected range would make widening it show nothing more than before; at one point
 * a second, six hours is 21,600 points.
 */
export const SERIES_SPAN_MS = RANGE_MS['6h']

/**
 * How many promised ticks may pass between two points before the line breaks. Two,
 * for the reason the silence watchdog gives itself slack: one late frame is jitter,
 * not an outage. Past that, joining the points would draw measurements that were
 * never taken.
 */
export const GAP_TICKS = 2

/** Add a point and drop what has aged out of the held span. */
export function appendPoint(series: readonly LatencyPoint[], point: LatencyPoint): LatencyPoint[] {
  const floor = point.at - SERIES_SPAN_MS
  let start = 0
  while (start < series.length && series[start].at < floor) start++
  return [...series.slice(start), point]
}

/**
 * Split a time-ordered series wherever two neighbours are further apart than the
 * tick either of them was promised allows. Each run is drawn as its own line.
 */
export function segments(points: readonly LatencyPoint[]): LatencyPoint[][] {
  const runs: LatencyPoint[][] = []
  let run: LatencyPoint[] = []
  for (const p of points) {
    const prev = run[run.length - 1]
    if (prev && p.at - prev.at > GAP_TICKS * Math.max(prev.tickMs, p.tickMs)) {
      runs.push(run)
      run = []
    }
    run.push(p)
  }
  if (run.length > 0) runs.push(run)
  return runs
}
