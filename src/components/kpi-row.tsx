import { ArrowDown, ArrowUp, Minus } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { num } from '@/lib/format'
import type { ModuleMetricsSnapshot } from '@/lib/types'

type Trend = 'up-bad' | 'down-good' | 'flat'

function Delta({ trend, children }: { trend: Trend; children: React.ReactNode }) {
  const Icon = trend === 'up-bad' ? ArrowUp : trend === 'down-good' ? ArrowDown : Minus
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 font-mono text-[11px]',
        trend === 'up-bad' && 'text-crit',
        trend === 'down-good' && 'text-ok',
        trend === 'flat' && 'text-muted-foreground',
      )}
    >
      <Icon className="size-3" strokeWidth={2.5} aria-hidden />
      {children}
    </span>
  )
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

export function KpiRow({ metrics }: { metrics: ModuleMetricsSnapshot[] }) {
  const total = metrics.reduce((a, m) => a + m.count, 0)
  const errors = metrics.reduce((a, m) => a + m.errorCount, 0)
  const errorRate = total ? errors / total : 0
  const p95 = Math.max(0, ...metrics.map((m) => m.p95LatencyMs))
  const p99 = Math.max(0, ...metrics.map((m) => m.p99LatencyMs))
  const modules = metrics.filter((m) => m.moduleId !== '(platform)').length

  return (
    <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
      <Tile label="Requests · total" value={num(total)}>
        <Delta trend="up-bad">▲ 12% vs prev</Delta>
      </Tile>
      <Tile label="Error rate" value={(errorRate * 100).toFixed(2)} unit="%" valueClass="text-crit">
        <Delta trend="up-bad">▲ 0.31pp · {num(errors)} err</Delta>
      </Tile>
      <Tile label="Latency p95" value={String(p95)} unit="ms">
        <Delta trend="down-good">▼ 6ms · p99 {p99}ms</Delta>
      </Tile>
      <Tile label="Active modules" value={String(modules)}>
        <Delta trend="flat">1 worker · 1 container</Delta>
      </Tile>
    </div>
  )
}
