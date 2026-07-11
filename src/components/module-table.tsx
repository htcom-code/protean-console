import { Card } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ago, num, pct } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { ModuleMetricsSnapshot, ModuleStatus } from '@/lib/types'

function rateClass(rate: number): string {
  if (rate >= 0.05) return 'text-crit font-semibold'
  if (rate >= 0.01) return 'text-warn'
  return 'text-muted-foreground'
}

export function ModuleTable({
  metrics,
  modules,
}: {
  metrics: ModuleMetricsSnapshot[]
  modules: ModuleStatus[]
}) {
  // Join isolation mode by moduleId — the metrics API doesn't carry it, /platform/modules does.
  const modeById = new Map(modules.map((m) => [m.id, m.mode]))
  return (
    <Card className="overflow-hidden py-0">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <Th>Module</Th>
              <Th>Mode</Th>
              <Th right>Count</Th>
              <Th right>Err rate</Th>
              <Th right>p50</Th>
              <Th right>p95</Th>
              <Th right>p99</Th>
              <Th right>Max</Th>
              <Th>Last seen</Th>
            </TableRow>
          </TableHeader>
          <TableBody>
            {metrics.map((m) => (
              <TableRow key={m.moduleId} className="font-mono text-[13px]">
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
            ))}
          </TableBody>
        </Table>
      </div>
    </Card>
  )
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <TableHead
      className={cn(
        'font-mono text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground',
        right && 'text-right',
      )}
    >
      {children}
    </TableHead>
  )
}
