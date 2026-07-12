import { Moon, Pause, Play, ServerCrash, ShieldAlert, Sun, WifiOff } from 'lucide-react'
import type { ComponentType } from 'react'
import { BrandLockup } from '@/components/brand-lockup'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { ConnState } from '@/hooks/use-console-data'

type Tone = 'ok' | 'warn' | 'crit'
type StatusView = { label: string; tone: Tone; ping: boolean; title: string; Icon?: ComponentType<{ className?: string }> }

function statusView(conn: ConnState): StatusView {
  switch (conn.status) {
    case 'live':
      return { label: 'LIVE · 200 buffer', tone: 'ok', ping: true, title: 'connected to a live platform' }
    case 'sample':
      return { label: 'SAMPLE DATA', tone: 'warn', ping: false, title: 'no platform reachable — showing sample data' }
    case 'disconnected':
      if (conn.reason === 'auth')
        return {
          label: conn.httpStatus === 403 ? 'AUTH REJECTED' : 'AUTH REQUIRED',
          tone: 'crit',
          ping: false,
          title: `platform returned HTTP ${conn.httpStatus}`,
          Icon: ShieldAlert,
        }
      if (conn.reason === 'server')
        return {
          label: `PLATFORM ERROR${conn.httpStatus ? ` ${conn.httpStatus}` : ''}`,
          tone: 'crit',
          ping: false,
          title: 'platform returned a server error',
          Icon: ServerCrash,
        }
      return { label: 'DISCONNECTED', tone: 'crit', ping: false, title: 'platform unreachable — reconnecting', Icon: WifiOff }
    case 'paused':
      return { label: 'PAUSED', tone: 'warn', ping: false, title: 'stream disconnected — showing last data', Icon: Pause }
    default:
      return { label: 'CONNECTING…', tone: 'warn', ping: false, title: 'connecting to the platform' }
  }
}

const TONE_BADGE: Record<Tone, string> = {
  ok: 'bg-ok/12 text-ok',
  warn: 'bg-warn/14 text-warn',
  crit: 'bg-crit/14 text-crit',
}
const TONE_DOT: Record<Tone, string> = { ok: 'bg-ok', warn: 'bg-warn', crit: 'bg-crit' }

export function TopBar({
  streaming,
  onToggleStream,
  theme,
  onToggleTheme,
  conn,
}: {
  streaming: boolean
  onToggleStream: () => void
  theme: 'light' | 'dark'
  onToggleTheme: () => void
  conn: ConnState
}) {
  const s = statusView(conn)
  return (
    <header className="flex flex-wrap items-center gap-3.5">
      <BrandLockup />

      <span
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[11px]',
          TONE_BADGE[s.tone],
        )}
        title={s.title}
      >
        {s.Icon ? (
          <s.Icon className="size-3" aria-hidden />
        ) : (
          <span className={cn('relative size-1.5 rounded-full', TONE_DOT[s.tone])}>
            {s.ping && <span className="absolute inset-0 animate-ping rounded-full bg-ok" />}
          </span>
        )}
        {s.label}
      </span>

      <TooltipProvider delay={300}>
        <div className="ml-auto flex items-center gap-2.5">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="outline"
                  size="icon"
                  className="size-9"
                  onClick={onToggleStream}
                  aria-label={streaming ? 'Disconnect the live stream' : 'Connect the live stream'}
                >
                  {streaming ? <Pause className="size-4" /> : <Play className="size-4" />}
                </Button>
              }
            />
            <TooltipContent>{streaming ? 'Disconnect the live stream' : 'Connect the live stream'}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="outline"
                  size="icon"
                  className="size-9"
                  onClick={onToggleTheme}
                  aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
                >
                  {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
                </Button>
              }
            />
            <TooltipContent>{theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}</TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>
    </header>
  )
}
