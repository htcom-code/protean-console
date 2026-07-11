import { Check, TriangleAlert, X } from 'lucide-react'
import { cn } from '@/lib/utils'

/** HTTP status as a label-backed pill — status color always ships with an icon, never color alone. */
export function StatusPill({ status }: { status: number }) {
  const kind = status >= 500 ? 'crit' : status >= 400 ? 'warn' : 'ok'
  const Icon = kind === 'crit' ? X : kind === 'warn' ? TriangleAlert : Check
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-xs font-semibold tabular-nums',
        kind === 'ok' && 'bg-ok/12 text-ok',
        kind === 'warn' && 'bg-warn/14 text-warn',
        kind === 'crit' && 'bg-crit/14 text-crit',
      )}
    >
      <Icon className="size-3" strokeWidth={2.75} aria-hidden />
      {status}
    </span>
  )
}

const METHOD_CLASS: Record<string, string> = {
  GET: 'bg-ok/12 text-ok',
  POST: 'bg-primary/10 text-primary',
  PUT: 'bg-warn/14 text-warn',
  DELETE: 'bg-crit/12 text-crit',
  PATCH: 'bg-warn/14 text-warn',
}

export function MethodChip({ method }: { method: string }) {
  return (
    <span
      className={cn(
        'rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold tracking-wide',
        METHOD_CLASS[method] ?? 'bg-muted text-muted-foreground',
      )}
    >
      {method}
    </span>
  )
}
