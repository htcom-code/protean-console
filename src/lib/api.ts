import type { ModuleMetricsSnapshot, ModuleStatus, RequestTrace, TraceQuery } from './types'

const BASE = '/platform'
const TIMEOUT_MS = 8000

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

export interface LiveData {
  traces: RequestTrace[]
  metrics: ModuleMetricsSnapshot[]
  modules: ModuleStatus[] // joined into the module table for isolation mode / trust tier
  latencyP95: number[]
}

/** Why a fetch cycle failed — drives how the UI signals the outage. */
export type ConnReason = 'unreachable' | 'auth' | 'server'

export type FetchResult =
  | { ok: true; data: LiveData }
  | { ok: false; reason: ConnReason; status?: number }

class HttpError extends Error {
  status: number
  constructor(status: number, path: string) {
    super(`${path} → HTTP ${status}`)
    this.status = status
  }
}

async function getJson<T>(path: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    signal,
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) throw new HttpError(res.status, path)
  return (await res.json()) as T
}

/**
 * One control-plane fetch cycle against a live Protean platform. Never throws:
 * on failure it classifies the cause — `unreachable` (network/CORS/timeout),
 * `auth` (401/403), or `server` (other non-2xx) — so the caller can signal the
 * outage accurately instead of masking it. A timeout aborts a hung request so
 * polling can't stall. The mock fallback lives in the caller, not here — this
 * function only ever reports the real platform's state.
 */
export async function fetchSnapshot(query: TraceQuery): Promise<FetchResult> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const [traces, metrics, modules] = await Promise.all([
      getJson<RequestTrace[]>(`/traces${qs(query)}`, ctrl.signal),
      getJson<ModuleMetricsSnapshot[]>(`/traces/metrics`, ctrl.signal),
      getJson<ModuleStatus[]>(`/modules`, ctrl.signal),
    ])
    return { ok: true, data: { traces, metrics, modules, latencyP95: deriveP95(traces) } }
  } catch (e) {
    if (e instanceof HttpError) {
      if (e.status === 401 || e.status === 403) return { ok: false, reason: 'auth', status: e.status }
      return { ok: false, reason: 'server', status: e.status }
    }
    return { ok: false, reason: 'unreachable' } // network error, CORS, or timeout/abort
  } finally {
    clearTimeout(timer)
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
