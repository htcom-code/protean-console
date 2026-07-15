import { useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, ChevronsUpDown, Gauge, SearchX } from 'lucide-react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Card } from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ago, num, pct } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { ModuleMetricsSnapshot, ModuleStatus } from '@/lib/types'

export type MetricSortKey =
  | 'moduleId'
  | 'count'
  | 'errorRate'
  | 'p50LatencyMs'
  | 'p95LatencyMs'
  | 'p99LatencyMs'
  | 'maxLatencyMs'
  | 'lastSeenEpochMillis'
export interface MetricSort {
  key: MetricSortKey
  dir: 'asc' | 'desc'
}

const ROW_H = 37

function rateClass(rate: number): string {
  if (rate >= 0.05) return 'text-crit font-semibold'
  if (rate >= 0.01) return 'text-warn'
  return 'text-muted-foreground'
}

function compare(a: ModuleMetricsSnapshot, b: ModuleMetricsSnapshot, key: MetricSortKey): number {
  if (key === 'moduleId') return a.moduleId.localeCompare(b.moduleId)
  return a[key] - b[key]
}

export function ModuleTable({
  metrics,
  modules,
  sort,
  onSort,
  selectedId,
  onSelect,
}: {
  metrics: ModuleMetricsSnapshot[]
  modules: ModuleStatus[]
  sort: MetricSort
  onSort: (s: MetricSort) => void
  selectedId: string | null
  onSelect: (moduleId: string) => void
}) {
  const [q, setQ] = useState('')
  const [errorsOnly, setErrorsOnly] = useState(false)

  // Join isolation mode by moduleId — the metrics API doesn't carry it, /platform/modules does.
  const modeById = useMemo(() => new Map(modules.map((m) => [m.id, m.mode])), [modules])

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const filtered = metrics.filter((m) => {
      if (errorsOnly && m.errorRate <= 0) return false
      if (needle) {
        const hay = `${m.moduleId} ${modeById.get(m.moduleId) ?? ''}`.toLowerCase()
        if (!hay.includes(needle)) return false
      }
      return true
    })
    const sorted = [...filtered].sort((a, b) => compare(a, b, sort.key))
    if (sort.dir === 'desc') sorted.reverse()
    return sorted
  }, [metrics, modeById, q, errorsOnly, sort])

  const parentRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_H,
    overscan: 12,
  })
  const items = virtualizer.getVirtualItems()
  const paddingTop = items.length > 0 ? items[0].start : 0
  const paddingBottom = items.length > 0 ? virtualizer.getTotalSize() - items[items.length - 1].end : 0

  function toggleSort(key: MetricSortKey) {
    if (sort.key === key) onSort({ key, dir: sort.dir === 'asc' ? 'desc' : 'asc' })
    else onSort({ key, dir: 'desc' })
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2.5">
        <h2 className="text-sm font-semibold">Module metrics</h2>
        <span className="rounded-full border px-2.5 py-0.5 font-mono text-[11px] text-muted-foreground">
          {rows.length === metrics.length
            ? `${metrics.length} tracked`
            : `${rows.length} of ${metrics.length}`}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            aria-pressed={errorsOnly}
            onClick={() => setErrorsOnly((v) => !v)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11.5px] text-muted-foreground transition-colors',
              !errorsOnly && 'hover:text-foreground',
              errorsOnly && 'border-crit bg-crit text-white',
            )}
          >
            <span className={cn('size-2 rounded-full', errorsOnly ? 'bg-white' : 'bg-crit')} aria-hidden />
            Errors only
          </button>
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            type="search"
            placeholder="filter module / mode…"
            className="h-8 w-[190px] font-mono text-xs"
            aria-label="Filter modules"
          />
        </div>
      </div>

      <Card className="overflow-hidden py-0">
        {rows.length === 0 ? (
          metrics.length === 0 ? (
            <Empty className="min-h-[240px]">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Gauge />
                </EmptyMedia>
                <EmptyTitle>No module metrics</EmptyTitle>
                <EmptyDescription>
                  Per-module latency and error rates are opt-in. Enable{' '}
                  <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[12px] text-foreground">
                    protean.trace.metrics.enabled=true
                  </code>{' '}
                  on the platform and restart; rows appear once modules receive traffic.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Empty className="min-h-[240px]">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <SearchX />
                </EmptyMedia>
                <EmptyTitle>No modules match</EmptyTitle>
                <EmptyDescription>
                  Clear the filter or the Errors-only toggle to see all {metrics.length} tracked modules.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )
        ) : (
          <div ref={parentRef} className="max-h-[460px] overflow-auto">
            <table className="w-full caption-bottom text-sm">
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <SortTh label="Module" col="moduleId" sort={sort} onSort={toggleSort} />
                <Th>Mode</Th>
                <SortTh label="Count" col="count" sort={sort} onSort={toggleSort} right />
                <SortTh label="Err rate" col="errorRate" sort={sort} onSort={toggleSort} right />
                <SortTh label="p50" col="p50LatencyMs" sort={sort} onSort={toggleSort} right />
                <SortTh label="p95" col="p95LatencyMs" sort={sort} onSort={toggleSort} right />
                <SortTh label="p99" col="p99LatencyMs" sort={sort} onSort={toggleSort} right />
                <SortTh label="Max" col="maxLatencyMs" sort={sort} onSort={toggleSort} right />
                <SortTh label="Last seen" col="lastSeenEpochMillis" sort={sort} onSort={toggleSort} />
              </TableRow>
            </TableHeader>
            <TableBody>
              {paddingTop > 0 && (
                <tr>
                  <td colSpan={9} style={{ height: paddingTop, padding: 0, border: 0 }} />
                </tr>
              )}
              {items.map((vi) => {
                const m = rows[vi.index]
                return (
                  <TableRow
                    key={m.moduleId}
                    data-state={selectedId === m.moduleId ? 'selected' : undefined}
                    onClick={() => onSelect(m.moduleId)}
                    className="cursor-pointer font-mono text-[13px]"
                  >
                    <TableCell className="font-medium">{m.moduleId}</TableCell>
                    <TableCell className="text-muted-foreground">{modeById.get(m.moduleId) ?? '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{num(m.count)}</TableCell>
                    <TableCell className={cn('text-right tabular-nums', rateClass(m.errorRate))}>
                      {pct(m.errorRate)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{m.p50LatencyMs}</TableCell>
                    <TableCell className="text-right tabular-nums">{m.p95LatencyMs}</TableCell>
                    <TableCell className="text-right tabular-nums">{m.p99LatencyMs}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{m.maxLatencyMs}</TableCell>
                    <TableCell className="text-muted-foreground">{ago(m.lastSeenEpochMillis)}</TableCell>
                  </TableRow>
                )
              })}
              {paddingBottom > 0 && (
                <tr>
                  <td colSpan={9} style={{ height: paddingBottom, padding: 0, border: 0 }} />
                </tr>
              )}
            </TableBody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

const HEAD_CLASS =
  'font-mono text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground'

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <TableHead className={cn(HEAD_CLASS, right && 'text-right')}>{children}</TableHead>
}

function SortTh({
  label,
  col,
  sort,
  onSort,
  right,
}: {
  label: string
  col: MetricSortKey
  sort: MetricSort
  onSort: (key: MetricSortKey) => void
  right?: boolean
}) {
  const active = sort.key === col
  const Icon = !active ? ChevronsUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown
  return (
    <TableHead className={cn(HEAD_CLASS, right && 'text-right')}>
      <button
        type="button"
        onClick={() => onSort(col)}
        className={cn(
          'inline-flex items-center gap-1 transition-colors hover:text-foreground',
          right && 'flex-row-reverse',
          active && 'text-foreground',
        )}
      >
        {label}
        <Icon className={cn('size-3', !active && 'opacity-50')} aria-hidden />
      </button>
    </TableHead>
  )
}
