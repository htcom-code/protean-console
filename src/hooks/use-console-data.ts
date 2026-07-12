import { useEffect, useRef, useState } from 'react'
import { deriveP95, type ConnReason, type LiveData } from '@/lib/api'
import { mockLatencySeries, mockMetrics, mockModules, mockTraces } from '@/lib/mock'
import { traceKey } from '@/lib/trace-db'
import type { ModuleMetricsSnapshot, ModuleStatus, RequestTrace } from '@/lib/types'

const STREAM_URL = '/platform/traces/stream'
// Rolling window of recent traces kept in memory for the chart / status mix.
// Full history lives in IndexedDB (useTraceStore); this is just the live view.
const TRACE_WINDOW = 500
// If the stream never opens (no platform reachable), fall back to sample data.
const SAMPLE_DELAY_MS = 2500
// Tolerate a brief reconnect blip before flipping a live view to disconnected.
const DISCONNECT_GRACE_MS = 4000

/**
 * Connection state the console renders from:
 * - `initial`      — before the stream opens
 * - `sample`       — no platform reachable (cold start); showing grounded mock data
 * - `live`         — the SSE stream is open and delivering
 * - `disconnected` — the stream dropped after being live; last real data is kept
 *                    and marked stale (EventSource auto-reconnects → back to live)
 *
 * Note: EventSource can't surface HTTP status on failure, so a dropped stream is
 * always reported as `unreachable` (the auth/server distinction the old polling
 * path made is not available over SSE).
 */
export type ConnState =
  | { status: 'initial' }
  | { status: 'sample' }
  | { status: 'live'; lastUpdated: number }
  | { status: 'disconnected'; reason: ConnReason; httpStatus?: number; lastUpdated: number | null }
  | { status: 'paused'; lastUpdated: number | null } // stream deliberately closed by the user

function mockData(now: number): LiveData {
  return {
    traces: mockTraces(now),
    metrics: mockMetrics(now),
    modules: mockModules(),
    latencyP95: mockLatencySeries(),
  }
}

/**
 * Subscribes to the platform's SSE stream (`/platform/traces/stream`) and
 * assembles the console snapshot from its multiplexed `trace` / `metrics` /
 * `modules` events. Replaces the previous 5s REST polling: new data is pushed,
 * and the trace window accumulates deltas (deduped, capped) for the chart while
 * IndexedDB retains the full history. Mock data is shown only on a cold start
 * with no platform reachable.
 */
export function useConsoleData() {
  const [data, setData] = useState<LiveData | null>(null)
  const [conn, setConn] = useState<ConnState>({ status: 'initial' })
  const [streaming, setStreaming] = useState(true)

  const tracesRef = useRef<RequestTrace[]>([])
  const metricsRef = useRef<ModuleMetricsSnapshot[]>([])
  const modulesRef = useRef<ModuleStatus[]>([])
  const everOpenRef = useRef(false)
  const lastUpdatedRef = useRef<number | null>(null)

  useEffect(() => {
    // Deliberately disconnected — keep the last data frozen on screen.
    if (!streaming) {
      setConn({ status: 'paused', lastUpdated: lastUpdatedRef.current })
      return
    }

    let es: EventSource | null = null
    let sampleTimer: number | undefined
    let disconnectTimer: number | undefined
    let closed = false

    function publish() {
      const traces = tracesRef.current
      setData({ traces, metrics: metricsRef.current, modules: modulesRef.current, latencyP95: deriveP95(traces) })
    }

    // Merge an incoming trace batch into the rolling window (dedup by key,
    // newest-first, capped) — robust whether the server sends full snapshots or deltas.
    function mergeTraces(incoming: RequestTrace[]) {
      const byKey = new Map<string, RequestTrace>()
      for (const t of tracesRef.current) byKey.set(traceKey(t), t)
      for (const t of incoming) byKey.set(traceKey(t), t)
      tracesRef.current = [...byKey.values()]
        .sort((a, b) => b.epochMillis - a.epochMillis)
        .slice(0, TRACE_WINDOW)
    }

    function markLive() {
      everOpenRef.current = true
      lastUpdatedRef.current = Date.now()
      window.clearTimeout(sampleTimer)
      window.clearTimeout(disconnectTimer)
      setConn({ status: 'live', lastUpdated: lastUpdatedRef.current })
    }

    function parse<T>(e: Event): T | null {
      try {
        return JSON.parse((e as MessageEvent).data) as T
      } catch {
        return null
      }
    }

    try {
      es = new EventSource(STREAM_URL)
    } catch {
      setData(mockData(Date.now()))
      setConn({ status: 'sample' })
      return
    }

    // Cold-start: if the stream never opens, assume no platform is there and
    // show the explorable sample demo.
    sampleTimer = window.setTimeout(() => {
      if (!everOpenRef.current && !closed) {
        setData(mockData(Date.now()))
        setConn({ status: 'sample' })
      }
    }, SAMPLE_DELAY_MS)

    es.addEventListener('open', () => markLive())

    es.addEventListener('trace', (e) => {
      const batch = parse<RequestTrace[]>(e)
      if (!batch) return
      mergeTraces(batch)
      markLive()
      publish()
    })
    es.addEventListener('metrics', (e) => {
      const m = parse<ModuleMetricsSnapshot[]>(e)
      if (!m) return
      metricsRef.current = m
      markLive()
      publish()
    })
    es.addEventListener('modules', (e) => {
      const m = parse<ModuleStatus[]>(e)
      if (!m) return
      modulesRef.current = m
      markLive()
      publish()
    })

    es.addEventListener('error', () => {
      // EventSource auto-reconnects. If we were live, tolerate a brief blip, then
      // surface disconnected while keeping the last data on screen. Cold-start
      // (never opened) is handled by the sample fallback above.
      if (!everOpenRef.current || closed) return
      window.clearTimeout(disconnectTimer)
      disconnectTimer = window.setTimeout(() => {
        if (!closed) {
          setConn({ status: 'disconnected', reason: 'unreachable', lastUpdated: lastUpdatedRef.current })
        }
      }, DISCONNECT_GRACE_MS)
    })

    return () => {
      closed = true
      window.clearTimeout(sampleTimer)
      window.clearTimeout(disconnectTimer)
      es?.close()
    }
  }, [streaming])

  return { data, conn, streaming, setStreaming }
}
