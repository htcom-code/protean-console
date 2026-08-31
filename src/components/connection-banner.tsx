import { useEffect, useState } from 'react'
import { ServerCrash, ShieldAlert, WifiOff } from 'lucide-react'
import type { ConnState } from '@/hooks/use-console-data'

type Disconnected = Extract<ConnState, { status: 'disconnected' }>

function relativeAge(ts: number, now: number): string {
  const s = Math.max(0, Math.round((now - ts) / 1000))
  if (s < 60) return `${s}s ago`
  return `${Math.floor(s / 60)}m ${s % 60}s ago`
}

function describe(conn: Disconnected): { Icon: typeof WifiOff; title: string; detail: string } {
  switch (conn.reason) {
    case 'auth':
      return {
        Icon: ShieldAlert,
        title: conn.httpStatus === 403 ? 'Access denied' : 'Authentication required',
        detail: `The platform rejected the request (HTTP ${conn.httpStatus}).`,
      }
    case 'server':
      return {
        Icon: ServerCrash,
        title: 'Platform error',
        detail: `The platform returned an error${conn.httpStatus ? ` (HTTP ${conn.httpStatus})` : ''}.`,
      }
    default:
      return {
        Icon: WifiOff,
        title: 'Disconnected',
        detail: 'The platform is unreachable.',
      }
  }
}

/**
 * Prominent, always-visible strip shown while the live connection is down. Color
 * is paired with an icon + label (never color alone). When last-known-good data is
 * on screen it says so and ticks a relative age so stale numbers aren't mistaken
 * for current; otherwise it states that no data has loaded yet.
 */
export function ConnectionBanner({ conn }: { conn: Disconnected }) {
  const hasStale = conn.lastUpdated != null
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!hasStale) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [hasStale])

  const { Icon, title, detail } = describe(conn)

  return (
    <div
      role="status"
      aria-live="polite"
      className="mt-4 flex items-center gap-3 rounded-xl border border-crit/30 bg-crit/10 px-4 py-2.5 text-crit"
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[13px]">
        <span className="font-semibold">{title}</span>
        <span className="text-crit/85">{detail}</span>
        <span className="font-mono text-[11.5px] text-crit/70">
          {/* No interval is quoted. The gap between attempts is not one number: a
              refused connection raises `error` and retries on RECONNECT_DELAY_MS,
              while a stream that dies without raising one is only noticed after the
              silence window, so the same banner would have to say 5s and 11s at
              once. Measured 2026-09-01; the copy used to claim 5s for both. */}
          {hasStale
            ? `showing last data · updated ${relativeAge(conn.lastUpdated!, now)} · retrying`
            : 'no data loaded yet · retrying'}
        </span>
      </div>
    </div>
  )
}
