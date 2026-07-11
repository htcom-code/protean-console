import { useMemo, useState } from 'react'
import { TopBar } from '@/components/top-bar'
import { ConnectionBanner } from '@/components/connection-banner'
import { KpiRow } from '@/components/kpi-row'
import { LatencyChart } from '@/components/latency-chart'
import { StatusMix } from '@/components/status-mix'
import { ModuleTable } from '@/components/module-table'
import { TraceTable } from '@/components/trace-table'
import { Skeleton } from '@/components/ui/skeleton'
import { useConsoleData } from '@/hooks/use-console-data'
import { useTheme } from '@/hooks/use-theme'
import { cn } from '@/lib/utils'
import type { TimeRange, TraceQuery } from '@/lib/types'

const RANGE_LIMIT: Record<TimeRange, number> = { '5m': 100, '15m': 200, '1h': 200, '6h': 200 }

export default function App() {
  const { theme, toggle } = useTheme()
  const [range, setRange] = useState<TimeRange>('15m')

  const query = useMemo<TraceQuery>(() => ({ limit: RANGE_LIMIT[range] }), [range])
  const { data, conn } = useConsoleData(query)
  const disconnected = conn.status === 'disconnected'

  return (
    <div className="mx-auto max-w-[1200px] px-6 pb-16 pt-6">
      <TopBar range={range} onRange={setRange} theme={theme} onToggleTheme={toggle} conn={conn} />

      {disconnected && <ConnectionBanner conn={conn} />}

      {conn.status === 'initial' || !data ? (
        <LoadingState />
      ) : (
        <div
          className={cn('mt-6 flex flex-col gap-6', disconnected && 'opacity-60 transition-opacity')}
          aria-busy={disconnected}
        >
          <KpiRow metrics={data.metrics} range={range} />

          <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[1.9fr_1fr]">
            <LatencyChart series={data.latencyP95} />
            <StatusMix traces={data.traces} />
          </div>

          <section className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="text-sm font-semibold">Module metrics</h2>
              <span className="rounded-full border px-2.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                GET /platform/traces/metrics · {data.metrics.length} tracked
              </span>
            </div>
            <ModuleTable metrics={data.metrics} modules={data.modules} />
          </section>

          <TraceTable traces={data.traces} />

          <footer className="font-mono text-[11px] leading-relaxed text-muted-foreground">
            Columns map 1:1 to the platform trace surface — rows are{' '}
            <code className="rounded bg-card px-1.5 py-0.5">RequestTrace</code>, the module table is{' '}
            <code className="rounded bg-card px-1.5 py-0.5">ModuleMetricsSnapshot</code> (opt-in{' '}
            <code className="rounded bg-card px-1.5 py-0.5">protean.trace.metrics.enabled</code>). traceId is the
            correlation id shared with logs and RFC 9457 error bodies — click to copy.
          </footer>
        </div>
      )}
    </div>
  )
}

function LoadingState() {
  return (
    <div className="mt-6 flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[92px] rounded-xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[1.9fr_1fr]">
        <Skeleton className="h-[240px] rounded-xl" />
        <Skeleton className="h-[240px] rounded-xl" />
      </div>
      <Skeleton className="h-[260px] rounded-xl" />
    </div>
  )
}
