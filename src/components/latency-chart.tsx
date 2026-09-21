import { useId, useRef, useState } from 'react'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'

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

/** Single-series p95 latency area with a crosshair+tooltip. One hue (telemetry), no legend needed. */
export function LatencyChart({ series }: { series: number[] }) {
  const gradId = useId()
  const svgRef = useRef<SVGSVGElement>(null)
  const [hover, setHover] = useState<number | null>(null)
  const n = series.length
  const empty = n === 0

  // Nice round ticks give the scale; the top tick already clears the data max,
  // so the axis has headroom without an arbitrary multiplier.
  const gridVals = niceTicks(empty ? EMPTY_SCALE_MAX : Math.max(...series))
  const max = gridVals[gridVals.length - 1] || 1
  // A single bucket has no span to interpolate across — `i / (n - 1)` would be
  // 0/0 and poison every coordinate with NaN. Pin the lone sample to the right
  // edge, where the newest sample always sits for n > 1.
  const x = (i: number) => (n === 1 ? W - PAD.r : PAD.l + (i / (n - 1)) * (W - PAD.l - PAD.r))
  const y = (v: number) => PAD.t + (1 - v / max) * (H - PAD.t - PAD.b)

  const pts = series.map((v, i) => `${x(i)},${y(v)}`).join(' ')
  const area = empty ? '' : `${PAD.l},${y(0)} ${pts} ${x(n - 1)},${y(0)}`

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    if (empty) return // nothing to point at, and `x`/`y` have no sample to resolve
    const r = svgRef.current!.getBoundingClientRect()
    const relX = ((e.clientX - r.left) / r.width) * W
    const i = Math.max(0, Math.min(n - 1, Math.round((relX - PAD.l) / (W - PAD.l - PAD.r) * (n - 1))))
    setHover(i)
  }

  return (
    <Card className="gap-0 overflow-hidden pb-3">
      <CardHeader className="flex items-baseline justify-between pb-2">
        <CardTitle className="text-[13.5px] font-semibold">Latency p95 over time</CardTitle>
        <span className="font-mono text-[11px] text-muted-foreground">
          {empty ? 'ms · default scale' : 'ms · rolling window'}
        </span>
      </CardHeader>
      <div className="relative px-2.5">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="block h-[190px] w-full touch-none"
          preserveAspectRatio="none"
          role="img"
          aria-label="p95 latency over the rolling window"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
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
          {/* Line and area need two points to mean anything; with one bucket the
              area would ramp from a zero baseline it never measured. Show the dot alone.
              With no samples at all, nothing is drawn over the grid — an empty chart
              must not be given a shape to read. */}
          {n > 1 && <polygon points={area} fill={`url(#${gradId})`} />}
          {n > 1 && (
            <polyline points={pts} fill="none" stroke="var(--telemetry)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          )}
          {!empty && (
            <circle cx={x(n - 1)} cy={y(series[n - 1])} r={3.6} fill="var(--telemetry)" stroke="var(--card)" strokeWidth={2} />
          )}
          {hover != null && (
            <>
              <line x1={x(hover)} y1={PAD.t} x2={x(hover)} y2={H - PAD.b} stroke="var(--telemetry)" strokeWidth={1} opacity={0.5} />
              <circle cx={x(hover)} cy={y(series[hover])} r={4} fill="var(--telemetry)" stroke="var(--card)" strokeWidth={2} />
            </>
          )}
        </svg>
        {empty && (
          <p className="pointer-events-none absolute inset-0 flex items-center justify-center font-mono text-[11.5px] text-muted-foreground">
            No samples in this window yet
          </p>
        )}
        {hover != null && (
          <div
            className="pointer-events-none absolute -translate-x-1/2 -translate-y-2 rounded-md bg-foreground px-2 py-1 font-mono text-[11px] text-background shadow-lg"
            style={{ left: `${(x(hover) / W) * 100}%`, top: `${(y(series[hover]) / H) * 100}%` }}
          >
            <b className="text-[var(--telemetry)]">{series[hover]}ms</b> · −{n - 1 - hover}m
          </div>
        )}
      </div>
    </Card>
  )
}
