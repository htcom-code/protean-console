import { useCallback, useEffect, useRef, useState } from 'react'
import { deriveP95, type ConnReason, type LiveData } from '@/lib/api'
import { mockLatencySeries, mockMetrics, mockModules, mockSummary, mockTraces } from '@/lib/mock'
import { traceKey } from '@/lib/trace-db'
import type { ModuleMetricsSnapshot, ModuleStatus, RequestTrace, TraceSummary } from '@/lib/types'

const STREAM_URL = '/platform/traces/stream'
// Rolling window of recent traces kept in memory for the chart / status mix.
// Full history lives in IndexedDB (useTraceStore); this is just the live view.
const TRACE_WINDOW = 500
// If the stream never opens (no platform reachable), fall back to sample data.
const SAMPLE_DELAY_MS = 2500
// A healthy stream pushes metrics/modules snapshots ~1×/s, so it's never silent
// for long. If no event arrives within this window the connection is dead — even
// when EventSource still reports it open (see the watchdog note below).
const STALE_TIMEOUT_MS = 6000
// After a dead/stalled stream, wait this long before rebuilding the EventSource.
// Keep in sync with the "retrying every 5s" copy in ConnectionBanner.
const RECONNECT_DELAY_MS = 5000

/**
 * Connection state the console renders from:
 * - `initial`      — before the stream opens
 * - `sample`       — no platform reachable (cold start); showing grounded mock data
 * - `live`         — the SSE stream is open and delivering
 * - `disconnected` — the stream dropped after being live; last real data is kept
 *                    and marked stale. The hook rebuilds the stream on a timer, so
 *                    it returns to `live` once the platform is reachable again.
 *
 * Note: EventSource can't surface HTTP status on failure, so a dropped stream is
 * always reported as `unreachable` (the auth/server distinction the old polling
 * path made is not available over SSE). It also can't be trusted to fire `error`
 * when the connection dies behind a proxy, so a silence watchdog covers that case.
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
    summary: mockSummary(),
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
  const summaryRef = useRef<TraceSummary | null>(null)
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
    let staleTimer: number | undefined
    let reconnectTimer: number | undefined
    let closed = false

    function publish() {
      const traces = tracesRef.current
      setData({
        traces,
        metrics: metricsRef.current,
        modules: modulesRef.current,
        summary: summaryRef.current,
        latencyP95: deriveP95(traces),
      })
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

    function parse<T>(e: Event): T | null {
      try {
        return JSON.parse((e as MessageEvent).data) as T
      } catch {
        return null
      }
    }

    // (Re)arm the silence watchdog. A healthy stream pushes metrics/modules
    // snapshots ~1×/s, so if nothing arrives within STALE_TIMEOUT_MS the connection
    // is dead — even when EventSource still reports it open. A dev proxy (Vite) can
    // hold the client socket open after the upstream dies, so 'error' never fires;
    // the watchdog is then the ONLY signal that we've lost the platform.
    function armWatchdog() {
      window.clearTimeout(staleTimer)
      staleTimer = window.setTimeout(onSilence, STALE_TIMEOUT_MS)
    }

    function onSilence() {
      if (closed) return
      // Only surface "disconnected" once we've actually been live; a cold start
      // with no platform stays on the sample demo (handled below).
      if (everOpenRef.current) {
        setConn({ status: 'disconnected', reason: 'unreachable', lastUpdated: lastUpdatedRef.current })
      }
      reconnect()
    }

    // Tear down the (possibly half-open) stream and rebuild it after a short delay,
    // so the console recovers on its own when the platform returns — a stalled
    // EventSource won't reconnect itself once a proxy has wedged it open.
    function reconnect() {
      es?.close()
      window.clearTimeout(reconnectTimer)
      reconnectTimer = window.setTimeout(() => {
        if (!closed) open()
      }, RECONNECT_DELAY_MS)
    }

    function markLive() {
      everOpenRef.current = true
      lastUpdatedRef.current = Date.now()
      window.clearTimeout(sampleTimer)
      armWatchdog()
      setConn({ status: 'live', lastUpdated: lastUpdatedRef.current })
    }

    function open() {
      try {
        es = new EventSource(STREAM_URL)
      } catch {
        setData(mockData(Date.now()))
        setConn({ status: 'sample' })
        return
      }

      // Guard a stream that opens but never emits (or a proxy holding a dead socket
      // open): the watchdog fires if nothing arrives in time.
      armWatchdog()

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
      es.addEventListener('summary', (e) => {
        const s = parse<TraceSummary>(e)
        if (!s) return
        summaryRef.current = s
        markLive()
        publish()
      })

      es.addEventListener('error', () => {
        // The browser surfaced a stream error (typically a refused/closed
        // connection — in dev the proxy turns a dead upstream into this on a fresh
        // connect). Rebuild promptly. UI state is owned by the watchdog / markLive,
        // so we don't flip here — a momentary blip that recovers on its own won't
        // flicker the badge.
        if (closed) return
        reconnect()
      })
    }

    // Cold-start: if the stream never opens, assume no platform is there and show
    // the explorable sample demo. `everOpenRef` keeps this from overriding a real
    // outage once we've been live.
    sampleTimer = window.setTimeout(() => {
      if (!everOpenRef.current && !closed) {
        setData(mockData(Date.now()))
        setConn({ status: 'sample' })
      }
    }, SAMPLE_DELAY_MS)

    open()

    return () => {
      closed = true
      window.clearTimeout(sampleTimer)
      window.clearTimeout(staleTimer)
      window.clearTimeout(reconnectTimer)
      es?.close()
    }
  }, [streaming])

  // Drop the in-memory trace window. The trace store wipes IndexedDB, but this
  // window is what gets persisted on the next event — leaving it intact means a
  // cleared row is written straight back, so clearing has to reach both.
  const resetTraces = useCallback(() => {
    tracesRef.current = []
    setData((prev) => (prev ? { ...prev, traces: [], latencyP95: [] } : prev))
  }, [])

  return { data, conn, streaming, setStreaming, resetTraces }
}
