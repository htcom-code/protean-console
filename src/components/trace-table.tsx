import { useMemo, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { MethodChip, StatusPill } from '@/components/status-pill'
import { cn } from '@/lib/utils'
import { clock } from '@/lib/format'
import type { RequestTrace } from '@/lib/types'

type ChipKey = 'all' | 'errors' | 'slow'

function LatencyBar({ ms }: { ms: number }) {
  const pct = Math.min(100, (ms / 300) * 100)
  const color = ms > 200 ? 'var(--crit)' : ms > 100 ? 'var(--warn)' : 'var(--telemetry)'
  return (
    <span className="inline-flex items-center justify-end gap-2">
      <span className="h-[5px] w-[46px] overflow-hidden rounded-full bg-muted">
        <span className="block h-full rounded-full" style={{ width: `${Math.max(6, pct)}%`, background: color }} />
      </span>
      <span className="w-[46px] text-right font-mono tabular-nums">{ms}ms</span>
    </span>
  )
}

function shortId(id: string | null): string {
  return id ? `${id.slice(0, 8)}…` : '—'
}

export function TraceTable({ traces }: { traces: RequestTrace[] }) {
  const [chip, setChip] = useState<ChipKey>('all')
  const [q, setQ] = useState('')
  const [copied, setCopied] = useState<number | null>(null)

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return traces.filter((t) => {
      if (chip === 'errors' && !(t.error || t.status >= 400)) return false
      if (chip === 'slow' && t.latencyMs <= 100) return false
      if (needle) {
        const hay = `${t.uri} ${t.pattern ?? ''} ${t.moduleId ?? ''} ${t.traceId ?? ''}`.toLowerCase()
        if (!hay.includes(needle)) return false
      }
      return true
    })
  }, [traces, chip, q])

  async function copy(t: RequestTrace) {
    if (!t.traceId) return
    try {
      await navigator.clipboard.writeText(t.traceId)
      setCopied(t.seq)
      window.setTimeout(() => setCopied((c) => (c === t.seq ? null : c)), 900)
    } catch {
      /* clipboard blocked — ignore */
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2.5">
        <h2 className="text-sm font-semibold">Recent traces</h2>
        <span className="rounded-full border px-2.5 py-0.5 font-mono text-[11px] text-muted-foreground">
          {rows.length} of {traces.length}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {(
            [
              ['all', 'All'],
              ['errors', 'Errors only'],
              ['slow', 'Slow > 100ms'],
            ] as Array<[ChipKey, string]>
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={chip === key}
              onClick={() => setChip(key)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11.5px] text-muted-foreground transition-colors',
                chip !== key && 'hover:text-foreground',
                chip === key && key === 'errors' && 'border-crit bg-crit text-white',
                chip === key && key !== 'errors' && 'border-foreground bg-foreground text-background',
              )}
            >
              {key === 'errors' && (
                <span
                  className={cn('size-2 rounded-full', chip === 'errors' ? 'bg-white' : 'bg-crit')}
                  aria-hidden
                />
              )}
              {label}
            </button>
          ))}
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            type="search"
            placeholder="filter uri / module / traceId…"
            className="h-8 w-[210px] font-mono text-xs"
            aria-label="Filter traces"
          />
        </div>
      </div>

      <Card className="overflow-hidden py-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <Th right>seq</Th>
                <Th>Time</Th>
                <Th>Method</Th>
                <Th>URI</Th>
                <Th>Module</Th>
                <Th>Status</Th>
                <Th right>Latency</Th>
                <Th>traceId</Th>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((t) => (
                <TableRow
                  key={t.seq}
                  className={cn('text-[13px]', t.error && 'shadow-[inset_3px_0_0_var(--crit)]')}
                >
                  <TableCell className="text-right font-mono tabular-nums text-muted-foreground">{t.seq}</TableCell>
                  <TableCell className="font-mono text-muted-foreground">{clock(t.epochMillis)}</TableCell>
                  <TableCell>
                    <MethodChip method={t.method} />
                  </TableCell>
                  <TableCell className="font-mono">
                    <span className="font-medium">{t.uri}</span>
                    {t.pattern && t.pattern !== t.uri && (
                      <span className="text-muted-foreground"> → {t.pattern}</span>
                    )}
                    {t.error && (
                      <span className="text-crit"> · {t.error.replace(/^.*\./, '')}</span>
                    )}
                  </TableCell>
                  <TableCell className={cn('font-mono', t.moduleId ? '' : 'text-muted-foreground')}>
                    {t.moduleId ?? '(platform)'}
                  </TableCell>
                  <TableCell>
                    <StatusPill status={t.status} />
                  </TableCell>
                  <TableCell className="text-right">
                    <LatencyBar ms={t.latencyMs} />
                  </TableCell>
                  <TableCell
                    className="cursor-copy font-mono text-muted-foreground hover:text-foreground"
                    title="click to copy traceId"
                    onClick={() => copy(t)}
                  >
                    {copied === t.seq ? 'copied ✓' : shortId(t.traceId)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
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
