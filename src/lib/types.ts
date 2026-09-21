/**
 * Mirrors org.htcom.protean.web.StreamReady (SSE `ready` event).
 *
 * The connection acknowledgement: the first frame of every stream connection,
 * ahead of the initial `trace` replay, and repeated on every reconnect. It exists
 * because "the stream is open" and "the platform is actually running" look
 * identical to a client on a quiet platform — nothing else arrives until traffic
 * does.
 *
 * It carries only what a client must learn once, at connect time, and cannot
 * derive from the stream afterwards. Everything that changes on a schedule stays
 * in the `metrics` / `modules` / `summary` frames.
 *
 * `platform` is display and diagnostics only — the console must not branch its
 * behaviour on which implementation answered. Later versions may add fields; the
 * console ignores the ones it does not recognize.
 */
export interface StreamReady {
  platform: string // implementation id, e.g. "protean" (Java), for display only
  platformVersion: string | null // null when the platform cannot read its own version
  tracesEnabled: boolean // protean.trace.enabled
  metricsEnabled: boolean // protean.trace.metrics.enabled
  buffered: number // rows the `trace` frame that follows carries — not the ring's size
  tickMs: number // push period, the contract a silence watchdog sizes itself against
  capacity: number // protean.trace.capacity as of this connection
}

// Mirrors org.htcom.protean.runtime.RequestTrace
export interface RequestTrace {
  seq: number
  epochMillis: number
  method: string
  uri: string
  pattern: string | null
  moduleId: string | null
  status: number
  latencyMs: number
  error: string | null
  traceId: string | null
}

// Mirrors org.htcom.protean.runtime.ModuleMetricsSnapshot
export interface ModuleMetricsSnapshot {
  moduleId: string
  count: number
  errorCount: number
  errorRate: number
  p50LatencyMs: number
  p95LatencyMs: number
  p99LatencyMs: number
  maxLatencyMs: number
  lastSeenEpochMillis: number
}

// Mirrors org.htcom.protean.runtime.TraceSummary (SSE `summary` event).
// Windowed header aggregate the platform ticker computes out-of-band over the
// last `windowMs`, plus the trend vs the previous same-length window. The three
// delta fields are null when the previous window had no samples — the console
// then hides the trend rather than inventing one.
export interface TraceSummary {
  windowMs: number
  count: number
  errorCount: number
  errorRate: number
  p50LatencyMs: number
  p95LatencyMs: number
  p99LatencyMs: number
  maxLatencyMs: number
  requestsDeltaPct: number | null // (cur-prev)/prev, fraction (0.12 = +12%)
  errorRateDeltaPp: number | null // (cur-prev)*100, percentage points
  p95DeltaMs: number | null // cur-prev, ms
  activeModules: number
  modulesByMode: Record<string, number> // active modules grouped by isolation mode
}

// Mirrors org.htcom.protean.web.ModuleStatus (GET /platform/modules)
export interface ModuleStatus {
  id: string
  version: string
  trustTier: string
  desiredState: string
  controllerFqcn: string | null
  mode: string
  needsSharedBeans: boolean
  bridgedInterfaces: string[] | null
}

// Mirrors org.htcom.protean.dynamic.DynamicEndpointRegistrar.RouteInfo
// (GET /platform/modules/{id}/routes — backend endpoint pending)
export interface RouteInfo {
  methods: string[]
  patterns: string[]
}

// GET /platform/traces query params (all optional; AND-combined, newest-first)
export interface TraceQuery {
  limit?: number
  moduleId?: string
  errorsOnly?: boolean
  status?: number
  minLatencyMs?: number
  since?: number
  beforeSeq?: number
}

export type TimeRange = '5m' | '15m' | '1h' | '6h'
