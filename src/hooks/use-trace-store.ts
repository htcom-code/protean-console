import { useCallback, useEffect, useRef, useState } from 'react'
import {
  clearTraces,
  countTraces,
  getTracePage,
  pruneTraces,
  traceKey,
  upsertTraces,
  type StoredTrace,
} from '@/lib/trace-db'
import type { RequestTrace } from '@/lib/types'

const PAGE = 200

function withKey(t: RequestTrace): StoredTrace {
  return { ...t, _key: traceKey(t) }
}

/** Merge rows newest-first, deduped by `_key` (later wins on collision). */
function merge(a: StoredTrace[], b: StoredTrace[]): StoredTrace[] {
  const byKey = new Map<string, StoredTrace>()
  for (const t of a) byKey.set(t._key, t)
  for (const t of b) byKey.set(t._key, t)
  return [...byKey.values()].sort((x, y) => y.epochMillis - x.epochMillis)
}

export interface TraceStoreView {
  rows: StoredTrace[]
  total: number
  hasMore: boolean
  loadingOlder: boolean
  loadOlder: () => void
  clear: () => void
}

/**
 * Trace list backed by IndexedDB history. When `persist` is true (a live
 * platform), every incoming batch is upserted + pruned and merged onto the
 * retained history, and older pages load on demand. When false (cold-start
 * sample data) it passes the given traces straight through without touching IDB.
 */
export function useTraceStore(liveTraces: RequestTrace[], persist: boolean): TraceStoreView {
  const [rows, setRows] = useState<StoredTrace[]>([])
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)

  const rowsRef = useRef(rows)
  rowsRef.current = rows

  // Sample mode: no persistence, just show what we were handed.
  useEffect(() => {
    if (persist) return
    const passthrough = liveTraces.map(withKey).sort((a, b) => b.epochMillis - a.epochMillis)
    setRows(passthrough)
    setTotal(passthrough.length)
    setHasMore(false)
  }, [persist, liveTraces])

  // Live mode: seed the display window from IDB once.
  useEffect(() => {
    if (!persist) return
    let cancelled = false
    void (async () => {
      try {
        const first = await getTracePage(PAGE)
        if (cancelled) return
        setRows((prev) => merge(prev, first))
        setHasMore(first.length === PAGE)
        setTotal(await countTraces())
      } catch {
        /* IDB unavailable — live merges below still populate the view */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [persist])

  // Live mode: persist + merge each incoming batch. Persistence is best-effort;
  // the incoming batch is always merged into the view even if IDB write fails.
  useEffect(() => {
    if (!persist || liveTraces.length === 0) return
    let cancelled = false
    const batch = liveTraces.map(withKey)
    void (async () => {
      try {
        await upsertTraces(liveTraces)
        await pruneTraces()
        if (cancelled) return
        setTotal(await countTraces())
      } catch {
        /* IDB write failed — fall back to in-memory only */
      }
      if (!cancelled) setRows((prev) => merge(prev, batch))
    })()
    return () => {
      cancelled = true
    }
  }, [persist, liveTraces])

  const loadOlder = useCallback(() => {
    setLoadingOlder(true)
    void (async () => {
      const current = rowsRef.current
      const oldest = current[current.length - 1]
      const page = await getTracePage(PAGE, oldest?.epochMillis)
      setRows((prev) => merge(prev, page))
      setHasMore(page.length === PAGE)
      setLoadingOlder(false)
    })()
  }, [])

  // Wipe the persisted history and the display window. In live mode the next SSE
  // batch immediately re-seeds the view (and re-persists), so this clears the
  // accumulated backlog rather than freezing an empty table.
  const clear = useCallback(() => {
    void (async () => {
      try {
        await clearTraces()
      } catch {
        /* IDB unavailable — still clear the in-memory view */
      }
      setRows([])
      setTotal(0)
      setHasMore(false)
    })()
  }, [])

  return { rows, total, hasMore, loadingOlder, loadOlder, clear }
}
