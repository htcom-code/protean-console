import { useCallback, useEffect, useRef, useState } from 'react'
import { loadSnapshot, type Snapshot } from '@/lib/api'
import type { TraceQuery } from '@/lib/types'

const POLL_MS = 5000

/** Loads the console snapshot and refreshes it on an interval; re-fetches when the query changes. */
export function useConsoleData(query: TraceQuery) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const queryRef = useRef(query)
  queryRef.current = query

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const snap = await loadSnapshot(queryRef.current, Date.now())
    if (!signal?.aborted) {
      setSnapshot(snap)
      setLoading(false)
    }
  }, [])

  // Re-fetch immediately whenever the query changes.
  useEffect(() => {
    const ctrl = new AbortController()
    setLoading(true)
    void refresh(ctrl.signal)
    return () => ctrl.abort()
  }, [refresh, query])

  // Background polling.
  useEffect(() => {
    const id = window.setInterval(() => void refresh(), POLL_MS)
    return () => window.clearInterval(id)
  }, [refresh])

  return { snapshot, loading }
}
