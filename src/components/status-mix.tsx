import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import { num } from '@/lib/format'
import type { RequestTrace } from '@/lib/types'

const BUCKETS = [
  { key: '2xx', label: 'Success', color: 'var(--ok)', test: (s: number) => s >= 200 && s < 300 },
  { key: '3xx', label: 'Redirect', color: 'var(--primary)', test: (s: number) => s >= 300 && s < 400 },
  { key: '4xx', label: 'Client err', color: 'var(--warn)', test: (s: number) => s >= 400 && s < 500 },
  { key: '5xx', label: 'Server err', color: 'var(--crit)', test: (s: number) => s >= 500 },
]

/** Status-code distribution over the sampled traces — magnitude bars, one hue per status. */
export function StatusMix({ traces }: { traces: RequestTrace[] }) {
  const counts = BUCKETS.map((b) => ({ ...b, n: traces.filter((t) => b.test(t.status)).length }))
  const total = counts.reduce((a, b) => a + b.n, 0) || 1

  return (
    <Card className="gap-0">
      <CardHeader className="flex items-baseline justify-between pb-2">
        <CardTitle className="text-[13.5px] font-semibold">Status mix</CardTitle>
        <span className="font-mono text-[11px] text-muted-foreground">{num(total)} req</span>
      </CardHeader>
      <div className="flex flex-col gap-3 px-4 pb-4 pt-1.5">
        {counts.map((b) => (
          <div key={b.key} className="grid grid-cols-[52px_1fr_auto] items-center gap-3">
            <span className="flex items-center gap-1.5 font-mono text-xs">
              <span className="size-2 rounded-[3px]" style={{ background: b.color }} aria-hidden />
              {b.key}
            </span>
            <span className="h-2 overflow-hidden rounded-full bg-muted" title={b.label}>
              <span
                className="block h-full rounded-full"
                style={{ width: `${Math.max(2, (b.n / total) * 100)}%`, background: b.color }}
              />
            </span>
            <span className="font-mono text-xs tabular-nums text-muted-foreground">{num(b.n)}</span>
          </div>
        ))}
      </div>
    </Card>
  )
}
