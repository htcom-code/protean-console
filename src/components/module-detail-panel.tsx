import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getModuleRoutes, type RoutesResult } from '@/lib/api'
import { ago, num, pct } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { ModuleMetricsSnapshot, ModuleStatus } from '@/lib/types'

type RoutesState = { status: 'loading' } | { status: 'done'; result: RoutesResult }

/**
 * Slide-in detail panel for a selected module: status fields, metrics summary,
 * and its live-registered routes. The routes REST endpoint is not implemented
 * on the backend yet, so that section degrades to a "pending" note (it wires up
 * automatically once `GET /platform/modules/{id}/routes` ships).
 */
export function ModuleDetailPanel({
  moduleId,
  status,
  metrics,
  onClose,
}: {
  moduleId: string
  status: ModuleStatus | null
  metrics: ModuleMetricsSnapshot | null
  onClose: () => void
}) {
  // The fetched routes are stored together with the module they belong to, so
  // the view state is derived rather than reset from the effect. Resetting it
  // there showed the previous module's routes for one frame after `moduleId`
  // changed; keying the result to its input makes a mismatch mean "loading".
  const [loaded, setLoaded] = useState<{ moduleId: string; result: RoutesResult } | null>(null)
  const routes: RoutesState =
    loaded && loaded.moduleId === moduleId ? { status: 'done', result: loaded.result } : { status: 'loading' }

  useEffect(() => {
    let cancelled = false
    void getModuleRoutes(moduleId).then((result) => {
      if (!cancelled) setLoaded({ moduleId, result })
    })
    return () => {
      cancelled = true
    }
  }, [moduleId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px]" onClick={onClose} aria-hidden />
      <aside
        role="dialog"
        aria-label={`Module ${moduleId}`}
        className="relative flex h-full w-[440px] max-w-[90vw] flex-col overflow-y-auto bg-card shadow-xl ring-1 ring-foreground/10"
      >
        <header className="sticky top-0 flex items-center gap-2 border-b bg-card px-5 py-3.5">
          <div className="min-w-0">
            <div className="truncate font-mono text-sm font-semibold">{moduleId}</div>
            <div className="font-mono text-[11px] text-muted-foreground">module detail</div>
          </div>
          <Button variant="ghost" size="icon" className="ml-auto" onClick={onClose} aria-label="Close">
            <X className="size-4" />
          </Button>
        </header>

        <div className="flex flex-col gap-5 px-5 py-4">
          <Section title="Status">
            {status ? (
              <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 font-mono text-[12.5px]">
                <Field k="version" v={status.version} />
                <Field k="mode" v={status.mode} />
                <Field k="trust tier" v={status.trustTier} />
                <Field k="desired" v={status.desiredState} />
                <Field k="shared beans" v={status.needsSharedBeans ? 'yes' : 'no'} />
                <Field k="controller" v={status.controllerFqcn ?? '—'} />
                {status.bridgedInterfaces && status.bridgedInterfaces.length > 0 && (
                  <Field k="bridged" v={status.bridgedInterfaces.join(', ')} />
                )}
              </dl>
            ) : (
              <p className="font-mono text-[12px] text-muted-foreground">
                No module-status record (platform-internal or not registered).
              </p>
            )}
          </Section>

          {metrics && (
            <Section title="Metrics">
              <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 font-mono text-[12.5px]">
                <Field k="count" v={num(metrics.count)} />
                <Field k="err rate" v={pct(metrics.errorRate)} />
                <Field k="p50 / p95" v={`${metrics.p50LatencyMs} / ${metrics.p95LatencyMs} ms`} />
                <Field k="p99 / max" v={`${metrics.p99LatencyMs} / ${metrics.maxLatencyMs} ms`} />
                <Field k="last seen" v={ago(metrics.lastSeenEpochMillis)} />
              </dl>
            </Section>
          )}

          <Section title="Routes">
            <RoutesBody state={routes} />
          </Section>
        </div>
      </aside>
    </div>
  )
}

function RoutesBody({ state }: { state: RoutesState }) {
  if (state.status === 'loading') {
    return <p className="font-mono text-[12px] text-muted-foreground">loading…</p>
  }
  const { result } = state
  if (!result.ok) {
    return (
      <p className="rounded-md border border-dashed px-3 py-2 font-mono text-[11.5px] text-muted-foreground">
        {result.reason === 'unavailable'
          ? 'Route listing not available yet — pending backend endpoint GET /platform/modules/{id}/routes.'
          : 'Failed to load routes.'}
      </p>
    )
  }
  if (result.routes.length === 0) {
    return <p className="font-mono text-[12px] text-muted-foreground">No registered routes.</p>
  }
  return (
    <ul className="flex flex-col gap-1.5">
      {result.routes.map((r, i) => {
        const methods = r.methods ?? []
        const patterns = r.patterns ?? []
        return (
          <li key={i} className="flex flex-wrap items-center gap-1.5 font-mono text-[12.5px]">
            {methods.length === 0 ? (
              <MethodTag>ANY</MethodTag>
            ) : (
              methods.map((m) => <MethodTag key={m}>{m}</MethodTag>)
            )}
            <span>{patterns.join(', ')}</span>
          </li>
        )
      })}
    </ul>
  )
}

function MethodTag({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded border px-1.5 py-0.5 text-[10.5px] font-semibold uppercase text-muted-foreground">
      {children}
    </span>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className={cn('text-[11px] font-semibold uppercase tracking-wider text-muted-foreground')}>{title}</h3>
      {children}
    </section>
  )
}

function Field({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="break-all text-foreground">{v}</dd>
    </>
  )
}
