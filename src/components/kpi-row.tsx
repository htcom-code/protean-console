import { ArrowDown, ArrowUp, Minus } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { num } from '@/lib/format'
import type { ModuleMetricsSnapshot, TraceSummary } from '@/lib/types'

type Dir = 'up' | 'down' | 'flat'
type Tone = 'bad' | 'good' | 'neutral'

const dirOf = (n: number): Dir => (n > 0 ? 'up' : n < 0 ? 'down' : 'flat')
// Tone semantics differ per metric: more errors / higher latency is bad, but a
// change in request volume carries no good/bad meaning, so it stays neutral.
const badWhenUp = (n: number): Tone => (n === 0 ? 'neutral' : n > 0 ? 'bad' : 'good')

// Isolation modes arrive as free-form IsolationStrategy bean names (in-process /
// worker / container today, but not a fixed enum), already grouped by the platform
// into modulesByMode. Known modes lead in a stable order; anything new is appended
// alphabetically so the header stays readable.
const MODE_ORDER = ['worker', 'container', 'in-process']

function modeMix(byMode: Record<string, number>): string {
  const rank = (mode: string) => {
    const i = MODE_ORDER.indexOf(mode)
    return i === -1 ? MODE_ORDER.length : i
  }
  return Object.keys(byMode)
    .filter((mode) => byMode[mode] > 0) // omit modes with no active modules
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map((mode) => `${byMode[mode]} ${mode}`)
    .join(' · ')
}

function Delta({ dir, tone, children }: { dir: Dir; tone: Tone; children: React.ReactNode }) {
  const Icon = dir === 'up' ? ArrowUp : dir === 'down' ? ArrowDown : Minus
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 font-mono text-[11px]',
        tone === 'bad' && 'text-crit',
        tone === 'good' && 'text-ok',
        tone === 'neutral' && 'text-muted-foreground',
      )}
    >
      <Icon className="size-3" strokeWidth={2.5} aria-hidden />
      {children}
    </span>
  )
}

// Shown in place of a trend when the platform has no previous-window baseline yet
// (delta is null) or no summary event at all — never a fabricated number.
function Muted({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-[11px] text-muted-foreground">{children}</span>
}

function Tile({
  label,
  value,
  unit,
  children,
  valueClass,
}: {
  label: string
  value: string
  unit?: string
  children: React.ReactNode
  valueClass?: string
}) {
  return (
    <Card className="gap-1 px-4 py-3.5">
      <span className="font-mono text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className={cn('font-mono text-[27px] font-semibold leading-none tracking-tight tabular-nums', valueClass)}>
        {value}
        {unit && <span className="ml-0.5 text-sm font-medium text-muted-foreground">{unit}</span>}
      </span>
      <div className="mt-0.5">{children}</div>
    </Card>
  )
}

/**
 * Why the cumulative totals are unknown, or `null` when the numbers can be shown.
 *
 * Requests and error rate are sums over `metrics`, and an empty array sums to zero
 * whether or not anything was recorded. A platform with per-module metrics off sends
 * exactly that, so these tiles read "0 requests, 0.00%" over live traffic — the
 * module table already knew better from the same ack, and the tiles did not ask.
 *
 * The order is the module table's (`emptyMetrics`), for the same reason:
 * `metricsEnabled` is the effective value, so recording off reports metrics off too,
 * and recording is the cause worth naming. Rows that did arrive are always shown —
 * the setting is live and may have changed since the ack, but the rows are data.
 *
 * Not replaced with `summary.count`: that is capped by the ring `capacity`, so it
 * would read lower the busier the platform got. A dash is the honest answer.
 */
function totalsUnknown(
  metrics: ModuleMetricsSnapshot[],
  metricsEnabled: boolean | null,
  tracesEnabled: boolean | null,
): string | null {
  if (metrics.length > 0) return null
  if (tracesEnabled === false) return 'recording off'
  if (metricsEnabled === false) return 'metrics off'
  if (metricsEnabled === true) return null // on and idle: zero is the true count
  return 'not reported'
}

/**
 * Header KPIs. Requests and error rate are the platform's all-time cumulative
 * aggregates (from `metrics`); the sub-line under each is the recent-window trend
 * from the `summary` SSE event (windowed count / error rate / p95 vs the previous
 * window). When `summary` is absent or a trend field is null, the sub-line renders
 * a muted placeholder rather than a made-up delta. When the platform is not
 * aggregating per-module metrics the totals do not exist, and the tiles say why
 * instead of showing zero (`totalsUnknown`).
 *
 * Latency p95 is the exception: it is `summary`'s windowed p95, the same number the
 * latency chart plots, so the tile reads as the chart's newest point. It used to be
 * the worst per-module p95 from `metrics`, which sat beside a chart drawn from a
 * third source and agreed with neither. Until a `summary` arrives it shows a dash —
 * the per-module figure is a different measurement, not a stand-in for this one.
 */
export function KpiRow({
  metrics,
  summary,
  metricsEnabled = null,
  tracesEnabled = null,
}: {
  metrics: ModuleMetricsSnapshot[]
  summary: TraceSummary | null
  metricsEnabled?: boolean | null
  tracesEnabled?: boolean | null
}) {
  const unknown = totalsUnknown(metrics, metricsEnabled, tracesEnabled)
  const total = metrics.reduce((a, m) => a + m.count, 0)
  const errors = metrics.reduce((a, m) => a + m.errorCount, 0)
  const errorRate = total ? errors / total : 0
  const activeModules = metrics.filter((m) => m.moduleId !== '(platform)').length

  const win = summary ? `last ${Math.round(summary.windowMs / 1000)}s` : 'window'

  return (
    <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
      {/* The reason sits where the unit would, beside the dash: the sub-line keeps
          saying what it always says, and the tile stays one line tall. */}
      <Tile
        label="Requests · total"
        value={unknown ? '—' : num(total)}
        unit={unknown ? `\u00a0${unknown}` : undefined}
      >
        {summary?.requestsDeltaPct != null ? (
          <Delta dir={dirOf(summary.requestsDeltaPct)} tone="neutral">
            {Math.abs(summary.requestsDeltaPct * 100).toFixed(0)}% vs prev
          </Delta>
        ) : (
          <Muted>{win} · no baseline yet</Muted>
        )}
      </Tile>

      <Tile
        label="Error rate"
        value={unknown ? '—' : (errorRate * 100).toFixed(2)}
        unit={unknown ? `\u00a0${unknown}` : '%'}
        valueClass={unknown ? undefined : 'text-crit'}
      >
        {summary?.errorRateDeltaPp != null ? (
          <Delta dir={dirOf(summary.errorRateDeltaPp)} tone={badWhenUp(summary.errorRateDeltaPp)}>
            {Math.abs(summary.errorRateDeltaPp).toFixed(2)}pp · {num(summary.errorCount)} err
          </Delta>
        ) : summary ? (
          <Muted>{win} · {num(summary.errorCount)} err</Muted>
        ) : unknown ? (
          // The error count is the same sum as the rate above: no rows, no count.
          <Muted>{win} · no summary yet</Muted>
        ) : (
          <Muted>{win} · {num(errors)} err</Muted>
        )}
      </Tile>

      <Tile
        label="Latency p95"
        value={summary ? String(summary.p95LatencyMs) : '—'}
        unit={summary ? 'ms' : undefined}
      >
        {summary?.p95DeltaMs != null ? (
          <Delta dir={dirOf(summary.p95DeltaMs)} tone={badWhenUp(summary.p95DeltaMs)}>
            {Math.abs(summary.p95DeltaMs)}ms · p99 {summary.p99LatencyMs}ms
          </Delta>
        ) : (
          <Muted>{summary ? `${win} · p99 ${summary.p99LatencyMs}ms` : 'no summary yet'}</Muted>
        )}
      </Tile>

      <Tile label="Active modules" value={String(summary?.activeModules ?? activeModules)}>
        {/* Not a trend — just the mode split, so no leading arrow/Minus icon. */}
        <Muted>{summary ? modeMix(summary.modulesByMode) || 'no modules' : '—'}</Muted>
      </Tile>
    </div>
  )
}
