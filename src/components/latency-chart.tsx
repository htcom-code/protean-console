import { useId, useRef, useState } from 'react'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'

const W = 720
const H = 190
const PAD = { t: 14, r: 10, b: 20, l: 30 }

/** Single-series p95 latency area with a crosshair+tooltip. One hue (telemetry), no legend needed. */
export function LatencyChart({ series }: { series: number[] }) {
  const gradId = useId()
  const svgRef = useRef<SVGSVGElement>(null)
  const [hover, setHover] = useState<number | null>(null)
  const n = series.length

  if (n === 0) return null
  const max = Math.max(...series) * 1.15 || 1
  const x = (i: number) => PAD.l + (i / (n - 1)) * (W - PAD.l - PAD.r)
  const y = (v: number) => PAD.t + (1 - v / max) * (H - PAD.t - PAD.b)

  const pts = series.map((v, i) => `${x(i)},${y(v)}`).join(' ')
  const area = `${PAD.l},${y(0)} ${pts} ${x(n - 1)},${y(0)}`
  const gridVals = [0, 25, 50, 75].filter((v) => v <= max)

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const r = svgRef.current!.getBoundingClientRect()
    const relX = ((e.clientX - r.left) / r.width) * W
    const i = Math.max(0, Math.min(n - 1, Math.round((relX - PAD.l) / (W - PAD.l - PAD.r) * (n - 1))))
    setHover(i)
  }

  return (
    <Card className="gap-0 overflow-hidden pb-3">
      <CardHeader className="flex items-baseline justify-between pb-2">
        <CardTitle className="text-[13.5px] font-semibold">Latency p95 over time</CardTitle>
        <span className="font-mono text-[11px] text-muted-foreground">ms · rolling window</span>
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
          <polygon points={area} fill={`url(#${gradId})`} />
          <polyline points={pts} fill="none" stroke="var(--telemetry)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          <circle cx={x(n - 1)} cy={y(series[n - 1])} r={3.6} fill="var(--telemetry)" stroke="var(--card)" strokeWidth={2} />
          {hover != null && (
            <>
              <line x1={x(hover)} y1={PAD.t} x2={x(hover)} y2={H - PAD.b} stroke="var(--telemetry)" strokeWidth={1} opacity={0.5} />
              <circle cx={x(hover)} cy={y(series[hover])} r={4} fill="var(--telemetry)" stroke="var(--card)" strokeWidth={2} />
            </>
          )}
        </svg>
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
