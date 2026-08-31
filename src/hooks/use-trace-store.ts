import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
const NO_ROWS: StoredTrace[] = []
const noop = () => {}

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
export function useTraceStore(
  liveTraces: RequestTrace[],
  persist: boolean,
  resetLive?: () => void,
): TraceStoreView {
  const [rows, setRows] = useState<StoredTrace[]>([])
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [dismissedSample, setDismissedSample] = useState<RequestTrace[] | null>(null)

  // `loadOlder` reads the newest rows without being re-created on every batch,
  // so the ref is mirrored in an effect rather than written during render.
  const rowsRef = useRef(rows)
  useEffect(() => {
    rowsRef.current = rows
  }, [rows])

  // Keys wiped by a clear. Every batch re-persists the whole live window, and a
  // platform may replay traces it already sent (a ring-buffer dump on reconnect),
  // so a cleared row has two ways back in. Filtering on the way to IDB closes
  // both. Holds only keys this session actually cleared.
  const clearedKeysRef = useRef<Set<string>>(new Set())

  // Read inside `clear`, which must not be re-created on every batch.
  const liveTracesRef = useRef(liveTraces)
  useEffect(() => {
    liveTracesRef.current = liveTraces
  }, [liveTraces])

  // Sample mode is a pure function of the traces we were handed, so it is
  // derived during render instead of synced into state through an effect. That
  // removes the setRows → render → effect cycle a caller with an unstable
  // `liveTraces` identity used to drive (it hit React's nested-update cap), and
  // with it the `sameRows` guard that existed only to break that cycle.
  const sampleRows = useMemo(
    () => (persist ? NO_ROWS : liveTraces.map(withKey).sort((a, b) => b.epochMillis - a.epochMillis)),
    [persist, liveTraces],
  )

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
    const fresh =
      clearedKeysRef.current.size === 0
        ? liveTraces
        : liveTraces.filter((t) => !clearedKeysRef.current.has(traceKey(t)))
    if (fresh.length === 0) return
    let cancelled = false
    const batch = fresh.map(withKey)
    void (async () => {
      try {
        await upsertTraces(fresh)
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

  // Wipe everything the user can see as history: IndexedDB, the display window,
  // and the caller's live trace window. Remember the keys so a later batch — or a
  // platform replaying its ring buffer — cannot write them back.
  const clear = useCallback(() => {
    for (const t of liveTracesRef.current) clearedKeysRef.current.add(traceKey(t))
    for (const r of rowsRef.current) clearedKeysRef.current.add(r._key)
    resetLive?.()
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
  }, [resetLive])

  // Sample mode has nothing persisted to wipe, so "clear" records which batch
  // was dismissed. Storing the input alongside the decision keeps the view
  // derivable: a new batch has a new identity and shows up on its own.
  const clearSample = useCallback(() => setDismissedSample(liveTraces), [liveTraces])

  if (!persist) {
    const shown = dismissedSample === liveTraces ? NO_ROWS : sampleRows
    return {
      rows: shown,
      total: shown.length,
      hasMore: false,
      loadingOlder: false,
      loadOlder: noop,
      clear: clearSample,
    }
  }

  return { rows, total, hasMore, loadingOlder, loadOlder, clear }
}
