import { AlertTriangle } from 'lucide-react'
import type { ReactNode } from 'react'
import type { Channel, ChannelStates } from '@/hooks/use-console-data'
import { cn } from '@/lib/utils'

/**
 * What a panel says when the channel feeding it has gone unreadable.
 *
 * The panel keeps showing the last data the platform sent correctly, which is the
 * right thing to show — and the wrong thing to show silently. A frozen number that
 * looks current is the most expensive failure an observability tool has: the
 * operator acts on it. So the panel dims and says so.
 *
 * The note reports what we know — frames arrived that we could not read — and
 * nothing else. It does not name a cause. We cannot tell a platform bug from a
 * version skew from a proxy mangling the body, and guessing in the copy is how the
 * module table came to tell operators to enable a setting that was already on.
 *
 * It does say how the mark goes away. A note with no stated exit reads as a fault
 * that needs attention, and one channel makes that misread likely: `trace` frames
 * only arrive when the platform serves a request, so on a quiet system the note
 * stays up long after the platform has recovered. Naming the exit turns "something
 * is broken" into "nothing has arrived yet", which is what is actually true.
 */
export function staleReason(channels: ChannelStates, feeds: readonly Channel[]): string | null {
  const bad = feeds.filter((c) => channels[c].stale)
  if (bad.length === 0) return null
  const frames = bad.reduce((n, c) => n + channels[c].rejected, 0)
  const which = bad.join(' and ')
  return `${which}: ${frames} frames this console could not read — showing the last data the platform sent correctly. Clears as soon as ${bad.length > 1 ? 'each channel delivers' : 'this channel delivers'} one readable frame.`
}

/** Dim + annotate a panel whose data has stopped being current. */
export function StalePanel({ reason, children }: { reason: string | null; children: ReactNode }) {
  if (!reason) return children
  return (
    <div className="flex flex-col gap-1.5" aria-busy>
      <p className="flex items-start gap-1.5 font-mono text-[11px] leading-relaxed text-warn">
        <AlertTriangle className="mt-[1px] size-3 shrink-0" aria-hidden />
        {reason}
      </p>
      <div className={cn('opacity-60 transition-opacity')}>{children}</div>
    </div>
  )
}
