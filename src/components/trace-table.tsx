import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { AlertTriangle, Inbox, SearchX, Trash2 } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { MethodChip, StatusPill } from '@/components/status-pill'
import { cn } from '@/lib/utils'
import { clock, num } from '@/lib/format'
import type { TraceStoreView } from '@/hooks/use-trace-store'
import type { StoredTrace } from '@/lib/trace-db'

type ChipKey = 'all' | 'errors' | 'slow'

const ROW_H = 41

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

export function TraceTable({
  store,
  staleReason,
}: {
  store: TraceStoreView
  /** Set when the trace channel has gone unreadable; shown in the header, never over the rows. */
  staleReason?: string | null
}) {
  const { rows: allRows, total, hasMore, loadingOlder, loadOlder, clear } = store
  const [chip, setChip] = useState<ChipKey>('all')
  const [q, setQ] = useState('')
  const [copied, setCopied] = useState<string | null>(null)

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return allRows.filter((t) => {
      if (chip === 'errors' && !(t.error || t.status >= 400)) return false
      if (chip === 'slow' && t.latencyMs <= 100) return false
      if (needle) {
        const hay = `${t.uri} ${t.pattern ?? ''} ${t.moduleId ?? ''} ${t.traceId ?? ''}`.toLowerCase()
        if (!hay.includes(needle)) return false
      }
      return true
    })
  }, [allRows, chip, q])

  const parentRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_H,
    overscan: 14,
  })
  const items = virtualizer.getVirtualItems()
  const paddingTop = items.length > 0 ? items[0].start : 0
  const paddingBottom = items.length > 0 ? virtualizer.getTotalSize() - items[items.length - 1].end : 0

  // Infinite scroll: pull the next IDB page when the last rows come into view.
  const lastIndex = items.length > 0 ? items[items.length - 1].index : 0
  useEffect(() => {
    if (hasMore && !loadingOlder && lastIndex >= rows.length - 15) loadOlder()
  }, [hasMore, loadingOlder, lastIndex, rows.length, loadOlder])

  async function copy(t: StoredTrace) {
    if (!t.traceId) return
    try {
      await navigator.clipboard.writeText(t.traceId)
      setCopied(t._key)
      window.setTimeout(() => setCopied((c) => (c === t._key ? null : c)), 900)
    } catch {
      /* clipboard blocked — ignore */
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {staleReason && (
        <p className="flex items-start gap-1.5 font-mono text-[11px] leading-relaxed text-warn">
          <AlertTriangle className="mt-[1px] size-3 shrink-0" aria-hidden />
          {staleReason}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2.5">
        <h2 className="text-sm font-semibold">Recent traces</h2>
        <span className="rounded-full border px-2.5 py-0.5 font-mono text-[11px] text-muted-foreground">
          {num(rows.length)} shown · {num(total)} retained
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
          <button
            type="button"
            onClick={clear}
            disabled={total === 0}
            aria-label="Clear retained trace history"
            title="Clear retained trace history (IndexedDB)"
            className="inline-flex items-center justify-center rounded-full border p-1.5 text-muted-foreground transition-colors hover:border-crit hover:text-crit disabled:opacity-40"
          >
            <Trash2 className="size-3.5" aria-hidden />
          </button>
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
        {rows.length === 0 ? (
          allRows.length === 0 ? (
            <Empty className="min-h-[240px]">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Inbox />
                </EmptyMedia>
                <EmptyTitle>No traces yet</EmptyTitle>
                <EmptyDescription>
                  Requests appear here as the platform serves them, and are kept across reloads.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Empty className="min-h-[240px]">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <SearchX />
                </EmptyMedia>
                <EmptyTitle>No traces match</EmptyTitle>
                <EmptyDescription>
                  Clear the filter or search to see all {num(total)} retained traces.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )
        ) : (
          <div ref={parentRef} className="max-h-[520px] overflow-auto">
            <table className="w-full caption-bottom text-sm">
            <TableHeader className="sticky top-0 z-10 bg-card">
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
              {paddingTop > 0 && (
                <tr>
                  <td colSpan={8} style={{ height: paddingTop, padding: 0, border: 0 }} />
                </tr>
              )}
              {items.map((vi) => {
                const t = rows[vi.index]
                return (
                  <TableRow
                    key={t._key}
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
                      {t.error && <span className="text-crit"> · {t.error.replace(/^.*\./, '')}</span>}
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
                      {copied === t._key ? 'copied ✓' : shortId(t.traceId)}
                    </TableCell>
                  </TableRow>
                )
              })}
              {paddingBottom > 0 && (
                <tr>
                  <td colSpan={8} style={{ height: paddingBottom, padding: 0, border: 0 }} />
                </tr>
              )}
            </TableBody>
            </table>
          </div>
        )}
      </Card>

      {hasMore && (
        <button
          type="button"
          onClick={loadOlder}
          disabled={loadingOlder}
          className="mx-auto rounded-full border px-3 py-1 font-mono text-[11.5px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
        >
          {loadingOlder ? 'loading…' : 'Load older'}
        </button>
      )}
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
