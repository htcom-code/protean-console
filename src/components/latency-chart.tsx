import { useEffect, useId, useRef, useState } from 'react'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import { ago, num } from '@/lib/format'
import { RANGE_MS, segments, type LatencyPoint } from '@/lib/latency-series'
import type { TimeRange } from '@/lib/types'

const W = 720
const H = 190
const PAD = { t: 14, r: 10, b: 20, l: 30 }

/**
 * Evenly-spaced round axis ticks spanning [0, max]. A fixed [0,25,50,75] set
 * collapses to the bottom of the axis whenever an outlier blows up the scale
 * (and drops all but 0 when the data is tiny); nice ticks keep the labels spread
 * across the height at any magnitude. Returns [0] when there is no positive data.
 */
function niceTicks(max: number, count = 4): number[] {
  if (!(max > 0)) return [0]
  const raw = max / count
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const norm = raw / mag
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag
  const ticks: number[] = []
  for (let v = 0; v <= max + step / 2; v += step) ticks.push(Math.round(v))
  return ticks
}

/**
 * The axis an empty chart is drawn on.
 *
 * With no samples there is nothing to scale to, and the card used to disappear
 * entirely — which left the row it shares with the status mix broken, and told a
 * platform with no traffic yet that it had no chart. The frame is drawn instead,
 * on a scale this console picked rather than measured, and the header says so:
 * a chart whose numbers could be read as a measured range is worse than none.
 */
const EMPTY_SCALE_MAX = 100

/** First index whose point is at or after `t`, in a time-ordered series. */
function firstAtOrAfter(points: readonly LatencyPoint[], t: number): number {
  let lo = 0
  let hi = points.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (points[mid].at < t) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** The point nearest in time to `t`. `points` is non-empty and time-ordered. */
function nearest(points: readonly LatencyPoint[], t: number): LatencyPoint {
  const i = firstAtOrAfter(points, t)
  if (i === 0) return points[0]
  if (i === points.length) return points[points.length - 1]
  return t - points[i - 1].at <= points[i].at - t ? points[i - 1] : points[i]
}

/** The clock the right edge follows, ticking while `running`. */
function useClock(running: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [running])
  return now
}

/**
 * p95 latency over time, one hue (telemetry), with a crosshair and tooltip.
 *
 * The x axis is time: it spans `range` and ends **now**, not at the newest point.
 * When the platform goes quiet the line slides left and the silence shows as empty
 * space on the right; a chart pinned to its last point would look live while
 * frozen. Before the range has filled, the left side is empty for the same reason —
 * the series only holds what arrived after this page connected.
 *
 * The line breaks wherever the points are further apart than their tick allows
 * (`segments`): joining across an outage would draw measurements never taken.
 *
 * Each point is the platform's p95 over its own `windowMs`, computed from at most
 * `capacity` traces — so the curve is smoothed by that window, and under load the
 * p95 is of the newest traces in it, not all of them. The header says both.
 *
 * `sample` marks the generated series shown when no platform answered. It is
 * anchored to its own last point rather than the clock: it is not a feed, and
 * sliding it away would only empty the demo.
 */
export function LatencyChart({
  points,
  range,
  sample = false,
  windowMs = null,
  capacity = null,
  now,
}: {
  points: readonly LatencyPoint[]
  range: TimeRange
  sample?: boolean
  windowMs?: number | null
  capacity?: number | null
  /** Pins the right edge. Tests use it; the app leaves it to the clock. */
  now?: number
}) {
  const gradId = useId()
  const svgRef = useRef<SVGSVGElement>(null)
  const [hoverX, setHoverX] = useState<number | null>(null)
  const clock = useClock(now == null && !sample)

  const span = RANGE_MS[range]
  const end = now ?? (sample && points.length > 0 ? points[points.length - 1].at : clock)
  const start = end - span
  const visible = points.slice(firstAtOrAfter(points, start), firstAtOrAfter(points, end + 1))
  const runs = segments(visible)
  const empty = visible.length === 0
  const newest = empty ? null : visible[visible.length - 1]

  let peak = 0
  for (const p of visible) if (p.p95 > peak) peak = p.p95

  // Nice round ticks give the scale; the top tick already clears the data max,
  // so the axis has headroom without an arbitrary multiplier.
  const gridVals = niceTicks(empty ? EMPTY_SCALE_MAX : peak)
  const max = gridVals[gridVals.length - 1] || 1
  const plotW = W - PAD.l - PAD.r
  const x = (t: number) => PAD.l + ((t - start) / span) * plotW
  const y = (v: number) => PAD.t + (1 - v / max) * (H - PAD.t - PAD.b)

  const hover = hoverX == null || empty ? null : nearest(visible, start + ((hoverX - PAD.l) / plotW) * span)

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    if (empty) return // nothing to point at
    const r = svgRef.current!.getBoundingClientRect()
    setHoverX(((e.clientX - r.left) / r.width) * W)
  }

  const header = sample
    ? 'ms · sample data'
    : empty
      ? 'ms · default scale'
      : [
          'ms',
          windowMs != null ? `p95 of ${Math.round(windowMs / 1000)}s` : null,
          capacity != null ? `≤${num(capacity)} traces` : null,
        ]
          .filter(Boolean)
          .join(' · ')

  return (
    <Card className="gap-0 overflow-hidden pb-3">
      <CardHeader className="flex items-baseline justify-between pb-2">
        <CardTitle className="text-[13.5px] font-semibold">Latency p95 over time</CardTitle>
        <span className="font-mono text-[11px] text-muted-foreground">{header}</span>
      </CardHeader>
      <div className="relative px-2.5">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="block h-[190px] w-full touch-none"
          preserveAspectRatio="none"
          role="img"
          aria-label={sample ? 'p95 latency, generated sample data' : `p95 latency over the last ${range}`}
          onPointerMove={onMove}
          onPointerLeave={() => setHoverX(null)}
        >
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--telemetry)" stopOpacity="0.22" />
              <stop offset="1" stopColor="var(--telemetry)" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          {gridVals.map((v) => (
            <g key={v}>
              <line x1={PAD.l} y1={y(v)} x2={W - PAD.r} y2={y(v)} stroke="var(--border)" strokeWidth={1} />
              <text x={PAD.l - 6} y={y(v) + 3} textAnchor="end" className="fill-muted-foreground font-mono text-[9px]">
                {v}
              </text>
            </g>
          ))}
          <text x={PAD.l} y={H - 5} className="fill-muted-foreground font-mono text-[9px]">
            −{range}
          </text>
          <text x={W - PAD.r} y={H - 5} textAnchor="end" className="fill-muted-foreground font-mono text-[9px]">
            {sample ? 'latest' : 'now'}
          </text>
          {/* One line per unbroken run. A run of one has nothing to join: drawing an
              area from a zero baseline would be a ramp the data never measured, so
              it is a dot. With no samples at all, nothing is drawn over the grid. */}
          {runs.map((run) => {
            const key = run[0].at
            if (run.length === 1) {
              return <circle key={key} cx={x(run[0].at)} cy={y(run[0].p95)} r={2.4} fill="var(--telemetry)" />
            }
            const pts = run.map((p) => `${x(p.at)},${y(p.p95)}`).join(' ')
            const area = `${x(run[0].at)},${y(0)} ${pts} ${x(run[run.length - 1].at)},${y(0)}`
            return (
              <g key={key}>
                <polygon points={area} fill={`url(#${gradId})`} />
                <polyline
                  points={pts}
                  fill="none"
                  stroke="var(--telemetry)"
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              </g>
            )
          })}
          {newest && (
            <circle
              data-newest=""
              cx={x(newest.at)}
              cy={y(newest.p95)}
              r={3.6}
              fill="var(--telemetry)"
              stroke="var(--card)"
              strokeWidth={2}
            />
          )}
          {hover && (
            <>
              <line
                x1={x(hover.at)}
                y1={PAD.t}
                x2={x(hover.at)}
                y2={H - PAD.b}
                stroke="var(--telemetry)"
                strokeWidth={1}
                opacity={0.5}
              />
              <circle cx={x(hover.at)} cy={y(hover.p95)} r={4} fill="var(--telemetry)" stroke="var(--card)" strokeWidth={2} />
            </>
          )}
        </svg>
        {empty && (
          <p className="pointer-events-none absolute inset-0 flex items-center justify-center font-mono text-[11.5px] text-muted-foreground">
            No samples in this window yet
          </p>
        )}
        {hover && (
          <div
            className="pointer-events-none absolute -translate-x-1/2 -translate-y-2 rounded-md bg-foreground px-2 py-1 font-mono text-[11px] text-background shadow-lg"
            style={{ left: `${(x(hover.at) / W) * 100}%`, top: `${(y(hover.p95) / H) * 100}%` }}
          >
            <b className="text-[var(--telemetry)]">{hover.p95}ms</b> · {ago(hover.at, end)}
          </div>
        )}
      </div>
    </Card>
  )
}
