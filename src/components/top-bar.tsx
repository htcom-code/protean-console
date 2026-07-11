import { Activity, Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import type { TimeRange } from '@/lib/types'

const RANGES: TimeRange[] = ['5m', '15m', '1h', '6h']

export function TopBar({
  range,
  onRange,
  theme,
  onToggleTheme,
  live,
}: {
  range: TimeRange
  onRange: (r: TimeRange) => void
  theme: 'light' | 'dark'
  onToggleTheme: () => void
  live: boolean
}) {
  return (
    <header className="flex flex-wrap items-center gap-3.5">
      <div className="flex items-center gap-3">
        <span className="grid size-9 place-items-center rounded-[10px] bg-gradient-to-br from-[var(--telemetry)] to-primary text-primary-foreground shadow-sm">
          <Activity className="size-5" strokeWidth={2.2} aria-hidden />
        </span>
        <div>
          <h1 className="text-[15px] font-semibold leading-tight tracking-tight">Protean · Trace Console</h1>
          <p className="font-mono text-[11.5px] text-muted-foreground">GET /platform/traces</p>
        </div>
      </div>

      <span
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[11px]',
          live ? 'bg-ok/12 text-ok' : 'bg-warn/14 text-warn',
        )}
        title={live ? 'connected to a live platform' : 'platform unreachable — showing sample data'}
      >
        <span className={cn('relative size-1.5 rounded-full', live ? 'bg-ok' : 'bg-warn')}>
          {live && <span className="absolute inset-0 animate-ping rounded-full bg-ok" />}
        </span>
        {live ? 'LIVE · 200 buffer' : 'SAMPLE DATA'}
      </span>

      <div className="ml-auto flex items-center gap-2.5">
        <Tabs value={range} onValueChange={(v) => onRange(v as TimeRange)}>
          <TabsList className="h-8">
            {RANGES.map((r) => (
              <TabsTrigger key={r} value={r} className="px-2.5 font-mono text-[11.5px]">
                {r}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Button
          variant="outline"
          size="icon"
          className="size-9"
          onClick={onToggleTheme}
          aria-label="Toggle light / dark theme"
        >
          {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </Button>
      </div>
    </header>
  )
}
