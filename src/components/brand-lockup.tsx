import { Activity } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * The Protean Trace Console brand mark + wordmark. Shared by the top bar and the
 * login screen so the lockup stays identical in both places.
 */
export function BrandLockup({
  subtitle = 'GET /platform/traces',
  size = 'sm',
  className,
}: {
  subtitle?: string
  size?: 'sm' | 'lg'
  className?: string
}) {
  const lg = size === 'lg'
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <span
        className={cn(
          'grid place-items-center rounded-[10px] bg-gradient-to-br from-[var(--telemetry)] to-primary text-primary-foreground shadow-sm',
          lg ? 'size-11' : 'size-9',
        )}
      >
        <Activity className={lg ? 'size-6' : 'size-5'} strokeWidth={2.2} aria-hidden />
      </span>
      <div>
        <h1 className={cn('font-semibold leading-tight tracking-tight', lg ? 'text-lg' : 'text-[15px]')}>
          Protean · Trace Console
        </h1>
        {subtitle && <p className="font-mono text-[11.5px] text-muted-foreground">{subtitle}</p>}
      </div>
    </div>
  )
}
