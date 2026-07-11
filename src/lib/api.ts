import { mockLatencySeries, mockMetrics, mockModules, mockTraces } from './mock'
import type { ModuleMetricsSnapshot, ModuleStatus, RequestTrace, TraceQuery } from './types'

const BASE = '/platform'

function qs(params: TraceQuery): string {
  const p = new URLSearchParams()
  if (params.limit != null) p.set('limit', String(params.limit))
  if (params.moduleId) p.set('moduleId', params.moduleId)
  if (params.errorsOnly) p.set('errorsOnly', 'true')
  if (params.status != null) p.set('status', String(params.status))
  if (params.minLatencyMs != null) p.set('minLatencyMs', String(params.minLatencyMs))
  if (params.since != null) p.set('since', String(params.since))
  if (params.beforeSeq != null) p.set('beforeSeq', String(params.beforeSeq))
  const s = p.toString()
  return s ? `?${s}` : ''
}

export interface Snapshot {
  traces: RequestTrace[]
  metrics: ModuleMetricsSnapshot[]
  modules: ModuleStatus[] // joined into the module table for isolation mode / trust tier
  latencyP95: number[]
  live: boolean // true = data came from a real platform, false = mock fallback
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    signal,
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`)
  return (await res.json()) as T
}

/**
 * Loads the whole console snapshot from a live Protean platform. When the platform
 * is unreachable (no dev target running) it falls back to grounded mock data so the
 * UI is still explorable — the returned {@link Snapshot.live} flag says which.
 */
export async function loadSnapshot(query: TraceQuery, now: number): Promise<Snapshot> {
  try {
    const [traces, metrics, modules] = await Promise.all([
      getJson<RequestTrace[]>(`/traces${qs(query)}`),
      getJson<ModuleMetricsSnapshot[]>(`/traces/metrics`),
      getJson<ModuleStatus[]>(`/modules`),
    ])
    return { traces, metrics, modules, latencyP95: deriveP95(traces), live: true }
  } catch {
    return {
      traces: mockTraces(now),
      metrics: mockMetrics(now),
      modules: mockModules(),
      latencyP95: mockLatencySeries(),
      live: false,
    }
  }
}

// Rough p95-per-minute bucketing from raw traces, for the live path.
function deriveP95(traces: RequestTrace[]): number[] {
  const buckets = new Map<number, number[]>()
  for (const t of traces) {
    const min = Math.floor(t.epochMillis / 60000)
    const arr = buckets.get(min) ?? []
    arr.push(t.latencyMs)
    buckets.set(min, arr)
  }
  return [...buckets.keys()]
    .sort((a, b) => a - b)
    .map((k) => {
      const arr = buckets.get(k)!.sort((a, b) => a - b)
      return arr[Math.min(arr.length - 1, Math.floor(arr.length * 0.95))]
    })
}
