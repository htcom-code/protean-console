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
