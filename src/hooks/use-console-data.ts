import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchSnapshot, type ConnReason, type LiveData } from '@/lib/api'
import { mockLatencySeries, mockMetrics, mockModules, mockTraces } from '@/lib/mock'
import type { TraceQuery } from '@/lib/types'

const POLL_MS = 5000
const FAIL_THRESHOLD = 2 // consecutive misses before a LIVE view flips to disconnected (blip tolerance)

/**
 * Connection state the console renders from:
 * - `initial`      — before the first response
 * - `sample`       — no platform ever reached (cold start); showing grounded mock data
 * - `live`         — last poll succeeded against a real platform
 * - `disconnected` — a platform was reached (or answered with an error) and is now
 *                    failing; the last real data (if any) is kept and marked stale
 */
export type ConnState =
  | { status: 'initial' }
  | { status: 'sample' }
  | { status: 'live'; lastUpdated: number }
  | { status: 'disconnected'; reason: ConnReason; httpStatus?: number; lastUpdated: number | null }

function mockData(now: number): LiveData {
  return {
    traces: mockTraces(now),
    metrics: mockMetrics(now),
    modules: mockModules(),
    latencyP95: mockLatencySeries(),
  }
}

/**
 * Loads the console snapshot and refreshes it on an interval. Never silently
 * swaps real data for mock: once a live platform has answered, a later outage
 * keeps the last real data and surfaces a `disconnected` state (auto-recovering
 * when the platform returns). Mock data is only used for a cold start with no
 * platform reachable (`sample`).
 */
export function useConsoleData(query: TraceQuery) {
  const [data, setData] = useState<LiveData | null>(null)
  const [conn, setConn] = useState<ConnState>({ status: 'initial' })

  const queryRef = useRef(query)
  queryRef.current = query
  const everLiveRef = useRef(false)
  const failuresRef = useRef(0)
  const lastUpdatedRef = useRef<number | null>(null)

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const res = await fetchSnapshot(queryRef.current)
    if (signal?.aborted) return
    const now = Date.now()

    if (res.ok) {
      everLiveRef.current = true
      failuresRef.current = 0
      lastUpdatedRef.current = now
      setData(res.data)
      setConn({ status: 'live', lastUpdated: now })
      return
    }

    failuresRef.current += 1

    if (everLiveRef.current) {
      // Was live: tolerate a brief blip, then mark disconnected while keeping the
      // last real data on screen (dimmed by the caller). Never replace with mock.
      if (failuresRef.current >= FAIL_THRESHOLD) {
        setConn({
          status: 'disconnected',
          reason: res.reason,
          httpStatus: res.status,
          lastUpdated: lastUpdatedRef.current,
        })
      }
      return
    }

    // Cold start, never connected. Only "unreachable" (no platform running) gets
    // the explorable mock demo; an auth/server response means a real platform is
    // there and rejecting/erroring, so we must not fabricate data.
    if (res.reason === 'unreachable') {
      setData(mockData(now))
      setConn({ status: 'sample' })
    } else {
      setData(null)
      setConn({ status: 'disconnected', reason: res.reason, httpStatus: res.status, lastUpdated: null })
    }
  }, [])

  // Re-fetch immediately whenever the query changes.
  useEffect(() => {
    const ctrl = new AbortController()
    void refresh(ctrl.signal)
    return () => ctrl.abort()
  }, [refresh, query])

  // Background polling.
  useEffect(() => {
    const id = window.setInterval(() => void refresh(), POLL_MS)
    return () => window.clearInterval(id)
  }, [refresh])

  return { data, conn }
}
