import { useMemo, useState } from 'react'
import { TopBar } from '@/components/top-bar'
import { ConnectionBanner } from '@/components/connection-banner'
import { KpiRow } from '@/components/kpi-row'
import { LatencyChart } from '@/components/latency-chart'
import { StatusMix } from '@/components/status-mix'
import { ModuleTable, type MetricSort } from '@/components/module-table'
import { ModuleDetailPanel } from '@/components/module-detail-panel'
import { TraceTable } from '@/components/trace-table'
import { LoginScreen } from '@/components/login-screen'
import { Skeleton } from '@/components/ui/skeleton'
import { useConsoleData } from '@/hooks/use-console-data'
import { useTraceStore } from '@/hooks/use-trace-store'
import { useTheme } from '@/hooks/use-theme'
import { useAuth } from '@/hooks/use-auth'
import { usePersistentState } from '@/hooks/use-persistent-state'
import { cn } from '@/lib/utils'
import type { TimeRange } from '@/lib/types'

const DEFAULT_SORT: MetricSort = { key: 'count', dir: 'desc' }

export default function App() {
  const { authenticated, signIn } = useAuth()
  const { theme, toggle } = useTheme()
  const [range, setRange] = usePersistentState<TimeRange>('pc:range', '15m')
  const [sort, setSort] = usePersistentState<MetricSort>('pc:metricsSort', DEFAULT_SORT)
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(null)

  const { data, conn } = useConsoleData()
  const disconnected = conn.status === 'disconnected'

  // Retain trace history in IndexedDB for a real platform; pass mock through.
  const persist = conn.status === 'live' || conn.status === 'disconnected'
  const traceStore = useTraceStore(data?.traces ?? [], persist)

  const selected = useMemo(() => {
    if (!selectedModuleId || !data) return null
    return {
      status: data.modules.find((m) => m.id === selectedModuleId) ?? null,
      metrics: data.metrics.find((m) => m.moduleId === selectedModuleId) ?? null,
    }
  }, [selectedModuleId, data])

  if (!authenticated) return <LoginScreen onSubmit={signIn} />

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

          <ModuleTable
            metrics={data.metrics}
            modules={data.modules}
            sort={sort}
            onSort={setSort}
            selectedId={selectedModuleId}
            onSelect={setSelectedModuleId}
          />

          <TraceTable store={traceStore} />

          <footer className="font-mono text-[11px] leading-relaxed text-muted-foreground">
            Columns map 1:1 to the platform trace surface — rows are{' '}
            <code className="rounded bg-card px-1.5 py-0.5">RequestTrace</code>, the module table is{' '}
            <code className="rounded bg-card px-1.5 py-0.5">ModuleMetricsSnapshot</code> (opt-in{' '}
            <code className="rounded bg-card px-1.5 py-0.5">protean.trace.metrics.enabled</code>). traceId is the
            correlation id shared with logs and RFC 9457 error bodies — click to copy.
          </footer>
        </div>
      )}

      {selectedModuleId && selected && (
        <ModuleDetailPanel
          moduleId={selectedModuleId}
          status={selected.status}
          metrics={selected.metrics}
          onClose={() => setSelectedModuleId(null)}
        />
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
