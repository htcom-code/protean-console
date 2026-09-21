import { useEffect, useRef, useState } from 'react'
import { deriveP95, type ConnReason, type LiveData } from '@/lib/api'
import { mockLatencySeries, mockMetrics, mockModules, mockSummary, mockTraces } from '@/lib/mock'
import { traceKey } from '@/lib/trace-db'
import type { ModuleMetricsSnapshot, ModuleStatus, RequestTrace, StreamReady, TraceSummary } from '@/lib/types'

const STREAM_URL = '/platform/traces/stream'

/**
 * The address of the platform this console is connected to, for display.
 *
 * Requests are relative, so they go to whatever origin served the console. In
 * development that origin is the Vite dev server, which forwards `/platform` to
 * `VITE_PROTEAN_TARGET` — the platform's real address, and the one worth showing,
 * since the dev server's own address is already in the browser's address bar.
 *
 * That target is only consulted in development. The proxy is a dev-server feature
 * that `vite build` does not carry, so a production bundle sends every request to
 * its own origin no matter what the variable said at build time. Printing the
 * variable there would name an address no request ever goes to.
 *
 * In dev the variable is always set: `vite.config.ts` resolves the proxy's target
 * — including its default — and injects that exact string, so this cannot name a
 * host the proxy is not forwarding to. The empty-string handling below is kept for
 * the case that injection is absent (a production bundle, or a test stubbing the
 * env directly).
 */
export function platformOrigin(): string {
  const configured = import.meta.env.DEV ? (import.meta.env.VITE_PROTEAN_TARGET as string | undefined) : undefined
  // Trimmed and checked for emptiness rather than nullishness: an exported-but-empty
  // variable is how a shell says "unset", and `??` would take it as an address and
  // leave the console naming nothing at all.
  const configuredTarget = configured?.trim()
  return (configuredTarget || window.location.origin).replace(/\/$/, '')
}
// Rolling window of recent traces kept in memory for the chart / status mix.
// Full history lives in IndexedDB (useTraceStore); this is just the live view.
const TRACE_WINDOW = 500
// If the stream never opens (no platform reachable), fall back to sample data.
// The wait is a user setting; this is the fallback for callers without one.
const SAMPLE_DELAY_MS = 2500
// How many pushes may be missed before the connection is called dead. A healthy
// stream pushes metrics/modules snapshots every `tickMs`, so silence for several
// periods means the connection is gone — even when EventSource still reports it
// open (see the watchdog note below).
const STALE_TICKS = 6
// The period assumed when the platform has not stated one. Before the `ready` ack
// existed, 1Hz was the console's standing assumption about every platform; it is
// still the only thing to fall back on for a platform that sends no ack, and it
// keeps the window at the 6s this console has always used.
const ASSUMED_TICK_MS = 1000
// The stated period is a contract, not a free hand. A period of a few
// milliseconds would make a watchdog that trips on ordinary scheduler jitter, and
// one of an hour would make a watchdog that never trips at all — and this is the
// only signal the console has that a platform is gone.
const MIN_STALE_WINDOW_MS = 2000
const MAX_STALE_WINDOW_MS = 60_000

/** The silence window for a platform that pushes every `tickMs`. */
function staleTimeoutFor(tickMs: number | null): number {
  const period = tickMs == null || !Number.isFinite(tickMs) || tickMs <= 0 ? ASSUMED_TICK_MS : tickMs
  return Math.min(MAX_STALE_WINDOW_MS, Math.max(MIN_STALE_WINDOW_MS, period * STALE_TICKS))
}
// Consecutive malformed frames on one channel before its panel is marked stale.
// One bad frame is an incident, not an outage: a platform mid-deploy can emit a
// single odd frame and recover on the next tick. Three ticks is under the silence
// window above (six), whatever the platform's period turns out to be, so a channel
// going bad can never take longer to surface than the whole stream going quiet.
const MALFORMED_TOLERANCE = 3
// After a dead/stalled stream, wait this long before rebuilding the EventSource.
// How long to wait before rebuilding a stream that failed. This is not the whole
// gap between attempts: when a stream dies without raising `error`, the silence
// window has to elapse first, which measured 11s end to end. ConnectionBanner
// quotes no interval for that reason.
const RECONNECT_DELAY_MS = 5000

/**
 * Connection state the console renders from:
 * - `initial`      — before the stream opens
 * - `sample`       — no platform reachable (cold start); showing grounded mock data
 * - `live`         — the SSE stream is open and delivering
 * - `disconnected` — the stream dropped after being live; last real data is kept
 *                    and marked stale. The hook rebuilds the stream on a timer, so
 *                    it returns to `live` once the platform is reachable again.
 * - `unreadable`   — frames are still arriving and none of them can be read. The
 *                    platform is not unreachable and rebuilding the stream would
 *                    fetch the same unreadable frames, so this is reported as what
 *                    it is rather than folded into an outage.
 *
 * Note: EventSource can't surface HTTP status on failure, so a dropped stream is
 * always reported as `unreachable` (the auth/server distinction the old polling
 * path made is not available over SSE). It also can't be trusted to fire `error`
 * when the connection dies behind a proxy, so a silence watchdog covers that case.
 */
/**
 * A channel the platform publishes on. Each one feeds a different part of the
 * screen, so they are tracked apart: one bad channel must not blank the rest.
 */
export type Channel = 'ready' | 'trace' | 'metrics' | 'modules' | 'summary'

/**
 * Per-channel health. `rejected` counts frames dropped since the channel was last
 * correct, `total` every frame it has ever dropped — the first drives the stale
 * mark, the second is what the badge reports so a burst that recovered is still
 * visible to whoever is looking.
 *
 * `stale: true` means: this panel is showing the last thing the platform said
 * correctly, and the platform has since sent something we could not read. It does
 * not say why. We do not know why.
 */
export interface ChannelHealth {
  rejected: number
  total: number
  stale: boolean
}

export type ChannelStates = Record<Channel, ChannelHealth>

const HEALTHY: ChannelHealth = { rejected: 0, total: 0, stale: false }
export const ALL_HEALTHY: ChannelStates = {
  ready: HEALTHY,
  trace: HEALTHY,
  metrics: HEALTHY,
  modules: HEALTHY,
  summary: HEALTHY,
}

export type ConnState =
  | { status: 'initial' }
  | { status: 'sample' }
  | { status: 'live'; lastUpdated: number }
  | { status: 'disconnected'; reason: ConnReason; httpStatus?: number; lastUpdated: number | null }
  | { status: 'unreadable'; lastUpdated: number | null } // connected and receiving, but nothing we can read
  | { status: 'paused'; lastUpdated: number | null } // stream deliberately closed by the user

/**
 * What the platform told us about itself when this connection opened — the
 * `ready` ack, with every field nullable.
 *
 * `null` for the whole thing means no ack arrived: an older platform, another
 * implementation that has not adopted the frame yet, or the sample demo. `null`
 * for one field means the ack did not carry a value this console could read for
 * it. Both say the same thing, and it is the only honest thing to say: we do not
 * know. Nothing here is defaulted into a number the screen could then present as
 * something the platform said.
 *
 * Connection-scoped, like the ack itself: it is dropped when the stream is rebuilt
 * and re-learned from the next ack, because `capacity` and the enabled flags are
 * live settings on the platform and the values from the last connection may no
 * longer be true.
 */
export type PlatformInfo = { [K in keyof StreamReady]: StreamReady[K] | null }

/** A `ready` value we can use, or `null` — never a substitute for one. */
function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}
function bool(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null
}
function int(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

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
export function useConsoleData(settings?: { sampleDelayMs: number }) {
  const [data, setData] = useState<LiveData | null>(null)
  const [conn, setConn] = useState<ConnState>({ status: 'initial' })
  const [streaming, setStreaming] = useState(true)
  const [channels, setChannels] = useState<ChannelStates>(ALL_HEALTHY)
  const [platform, setPlatform] = useState<PlatformInfo | null>(null)

  const tracesRef = useRef<RequestTrace[]>([])
  const metricsRef = useRef<ModuleMetricsSnapshot[]>([])
  const modulesRef = useRef<ModuleStatus[]>([])
  const summaryRef = useRef<TraceSummary | null>(null)
  const everOpenRef = useRef(false)
  const lastUpdatedRef = useRef<number | null>(null)
  // When a frame last arrived at all, readable or not. `lastUpdatedRef` only moves
  // for frames we could use, so the two together separate "the platform stopped
  // talking" from "the platform is talking and we cannot understand it".
  const lastFrameAtRef = useRef<number | null>(null)

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
    // When the stream currently being listened to was built. Reporting an outage
    // and tearing a stream down are different decisions on different clocks: the
    // first is owed to the operator the moment the data stops, the second must wait
    // until this stream has had its own chance to deliver something.
    let openedAt = 0
    // The silence window this connection is judged by. It starts as the assumed
    // period and narrows or widens to the one the `ready` ack states, so the
    // watchdog stops being a guess about the platform's tick the moment the
    // platform declares it. Reset per connection, since a rebuilt stream may reach
    // a platform that pushes at a different rate.
    let staleWindowMs = staleTimeoutFor(null)

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

    function parse(e: Event): unknown {
      try {
        return JSON.parse((e as MessageEvent).data) as unknown
      } catch {
        return undefined // unparseable is just another malformed frame
      }
    }

    // A frame we could not read leaves the channel's last good data on screen. It
    // must not also leave the screen claiming to be current, so the channel is
    // marked and the panel says so. Deliberately not `markLive()`: a rejected frame
    // is not evidence the platform is healthy, which is what makes a stream of
    // nothing but bad frames surface as an outage on the watchdog below.
    function reject(channel: Channel) {
      lastFrameAtRef.current = Date.now()
      setChannels((prev) => {
        const rejected = prev[channel].rejected + 1
        return {
          ...prev,
          [channel]: { rejected, total: prev[channel].total + 1, stale: rejected >= MALFORMED_TOLERANCE },
        }
      })
    }

    // One correct frame clears the mark. The channel is current again, and saying
    // otherwise would be its own kind of lie.
    function accept(channel: Channel) {
      setChannels((prev) =>
        prev[channel].rejected === 0 ? prev : { ...prev, [channel]: { ...prev[channel], rejected: 0, stale: false } },
      )
    }

    /**
     * Read a frame as the shape its channel promises, or reject it.
     *
     * Only the shape — an array where the contract says array, an object where it
     * says object. Per-field validation belongs to platform-parity checking, not
     * here: the job of this guard is that one malformed frame cannot take the
     * console down or quietly freeze a panel.
     */
    function readArray<T>(e: Event, channel: Channel): T[] | null {
      const v = parse(e)
      if (!Array.isArray(v)) {
        reject(channel)
        return null
      }
      accept(channel)
      return v as T[]
    }

    function readObject<T>(e: Event, channel: Channel): T | null {
      const v = parse(e)
      if (typeof v !== 'object' || v === null || Array.isArray(v)) {
        reject(channel)
        return null
      }
      accept(channel)
      return v as T
    }

    /**
     * Read the connection ack. Unknown fields are ignored and a field whose value
     * is not the type the contract promises is read as "not stated" rather than as
     * a malformed frame: the ack is extensible by design, and one field this
     * console cannot read is no reason to discard the six it can.
     */
    function readReady(e: Event): PlatformInfo | null {
      const v = readObject<Record<string, unknown>>(e, 'ready')
      if (!v) return null
      return {
        platform: str(v.platform),
        platformVersion: str(v.platformVersion),
        tracesEnabled: bool(v.tracesEnabled),
        metricsEnabled: bool(v.metricsEnabled),
        buffered: int(v.buffered),
        tickMs: int(v.tickMs),
        capacity: int(v.capacity),
      }
    }

    // (Re)arm the silence watchdog. A healthy stream pushes metrics/modules
    // snapshots every tick, so if nothing arrives within `staleWindowMs` the
    // connection is dead — even when EventSource still reports it open. A dev proxy
    // (Vite) can hold the client socket open after the upstream dies, so 'error'
    // never fires; the watchdog is then the ONLY signal that we've lost the platform.
    //
    // The deadline is anchored to the last frame we accepted, not to this call, so
    // re-arming can only bring it closer. `open` re-arms on every rebuilt stream,
    // and a refused platform rebuilds every RECONNECT_DELAY_MS (5s) — under the 6s
    // window a 1Hz platform gets. Setting a fresh window each time let the retry
    // loop postpone the deadline it exists to trip, and the console held LIVE over
    // a platform that was gone for as long as it kept failing.
    //
    // ⚠️ A platform that states a tick slower than RECONNECT_DELAY_MS gets a window
    // wider than its own retry interval, which is the correct way round: the
    // deadline is anchored to the last frame, so retries still cannot push it.
    function armWatchdog() {
      window.clearTimeout(staleTimer)
      const last = lastUpdatedRef.current
      const remaining = last == null ? staleWindowMs : Math.max(0, staleWindowMs - (Date.now() - last))
      staleTimer = window.setTimeout(onSilence, remaining)
    }

    function onSilence() {
      if (closed) return
      // Frames still arriving, none of them usable. The platform is reachable and
      // talking, so calling this unreachable would be false, and rebuilding the
      // stream would only fetch the same frames again. Report it for what it is
      // and keep the stream — the panels already name which channel went quiet.
      const lastFrame = lastFrameAtRef.current
      if (everOpenRef.current && lastFrame != null && Date.now() - lastFrame < staleWindowMs) {
        setConn({ status: 'unreadable', lastUpdated: lastUpdatedRef.current })
        // Anchored to the last frame, like the deadline above. Re-arming a fresh
        // window here would let the check drift a window behind the traffic, so a
        // platform that went unreadable and then silent could take twice as long to
        // be called an outage as one that simply went silent.
        window.clearTimeout(staleTimer)
        staleTimer = window.setTimeout(onSilence, Math.max(0, staleWindowMs - (Date.now() - lastFrame)))
        return
      }

      // Only surface "disconnected" once we've actually been live; a cold start
      // with no platform stays on the sample demo (handled below).
      if (everOpenRef.current) {
        setConn({ status: 'disconnected', reason: 'unreachable', lastUpdated: lastUpdatedRef.current })
      }
      // Rebuilding is on the stream's own clock. A stream built moments ago may
      // simply not have spoken yet, and closing it here would end the recovery it
      // was opened for — the deadline above is anchored to the last frame, so it
      // can come due while this stream is still new.
      const streamAge = Date.now() - openedAt
      if (streamAge >= staleWindowMs) {
        reconnect()
        return
      }
      window.clearTimeout(staleTimer)
      staleTimer = window.setTimeout(onSilence, staleWindowMs - streamAge)
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
      lastFrameAtRef.current = lastUpdatedRef.current
      window.clearTimeout(sampleTimer)
      armWatchdog()
      setConn({ status: 'live', lastUpdated: lastUpdatedRef.current })
    }

    function open() {
      openedAt = Date.now()
      // Connect-time facts belong to the connection that stated them. Carrying the
      // last one's `capacity` or `metricsEnabled` into this one would put a claim
      // on screen that nothing has made this connection — they are live settings,
      // and the platform answering now may not be the one that answered before.
      staleWindowMs = staleTimeoutFor(null)
      setPlatform((p) => (p === null ? p : null))
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

      // The ack. Listening for it is the point of the frame: on a quiet platform
      // nothing else arrives, so this is the only thing that tells the console the
      // stream is live rather than merely open.
      es.addEventListener('ready', (e) => {
        const info = readReady(e)
        if (!info) return
        setPlatform(info)
        staleWindowMs = staleTimeoutFor(info.tickMs)
        markLive() // re-arms the watchdog on the window the platform just stated
      })

      es.addEventListener('trace', (e) => {
        const batch = readArray<RequestTrace>(e, 'trace')
        if (!batch) return
        mergeTraces(batch)
        markLive()
        publish()
      })
      es.addEventListener('metrics', (e) => {
        const m = readArray<ModuleMetricsSnapshot>(e, 'metrics')
        if (!m) return
        metricsRef.current = m
        markLive()
        publish()
      })
      es.addEventListener('modules', (e) => {
        const m = readArray<ModuleStatus>(e, 'modules')
        if (!m) return
        modulesRef.current = m
        markLive()
        publish()
      })
      es.addEventListener('summary', (e) => {
        const s = readObject<TraceSummary>(e, 'summary')
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
    }, settings?.sampleDelayMs ?? SAMPLE_DELAY_MS)

    open()

    return () => {
      closed = true
      window.clearTimeout(sampleTimer)
      window.clearTimeout(staleTimer)
      window.clearTimeout(reconnectTimer)
      es?.close()
    }
  }, [streaming, settings?.sampleDelayMs])

  return { data, conn, channels, platform, streaming, setStreaming }
}
