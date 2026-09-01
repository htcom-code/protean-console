import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { RequestTrace } from '@/lib/types'

// Client-side trace history. The server keeps only a small ring buffer (~200),
// so anything older is owned here: every trace the client observes is upserted
// and retained across reloads, deduped, and paged back in on demand.
//
// Key choice: `seq` is per-server-process monotonic and RESETS on restart, so it
// can't be the dedup key (a restart would collide old high seqs). We key on
// `traceId` (a per-request correlation id) and order by `epochMillis` (wall
// clock, robust across restarts). Traces without a traceId fall back to a
// synthetic `epoch-seq` key.

const DB_NAME = 'pc-traces'
const DB_VERSION = 1
const STORE = 'traces'
const BY_EPOCH = 'byEpoch'

/**
 * Default cap on retained rows. The effective limit is a user setting
 * (`settings.ts`), which cannot go below this; this constant is its floor and the
 * fallback for callers that do not carry settings.
 */
export const TRACE_RETENTION = 50_000

export type StoredTrace = RequestTrace & { _key: string }

interface TraceDBSchema extends DBSchema {
  traces: {
    key: string
    value: StoredTrace
    indexes: { byEpoch: number }
  }
}

/** Stable dedup key: correlation id when present, else synthetic epoch-seq. */
export function traceKey(t: RequestTrace): string {
  return t.traceId ?? `${t.epochMillis}-${t.seq}`
}

let dbPromise: Promise<IDBPDatabase<TraceDBSchema>> | null = null

function db(): Promise<IDBPDatabase<TraceDBSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<TraceDBSchema>(DB_NAME, DB_VERSION, {
      upgrade(database) {
        const store = database.createObjectStore(STORE, { keyPath: '_key' })
        store.createIndex(BY_EPOCH, 'epochMillis')
      },
    })
  }
  return dbPromise
}

/**
 * Upsert a batch (idempotent by key). All puts are issued synchronously within
 * one transaction — no intervening awaits — so the tx can't auto-close mid-batch.
 */
export async function upsertTraces(traces: RequestTrace[]): Promise<void> {
  if (traces.length === 0) return
  const database = await db()
  const tx = database.transaction(STORE, 'readwrite')
  await Promise.all(traces.map((t) => tx.store.put({ ...t, _key: traceKey(t) })))
  await tx.done
}

/**
 * Read a page of traces newest-first. Pass `beforeEpoch` to fetch the page
 * immediately older than a previous page's last row (load-older). At dev scale
 * the epoch cursor is exclusive on that millisecond, which can skip rows sharing
 * the exact boundary millisecond — acceptable for this single-node view.
 */
export async function getTracePage(limit: number, beforeEpoch?: number): Promise<StoredTrace[]> {
  const database = await db()
  const range = beforeEpoch != null ? IDBKeyRange.upperBound(beforeEpoch, true) : undefined
  const out: StoredTrace[] = []
  let cursor = await database.transaction(STORE).store.index(BY_EPOCH).openCursor(range, 'prev')
  while (cursor && out.length < limit) {
    out.push(cursor.value)
    cursor = await cursor.continue()
  }
  return out
}

/** Total retained rows. */
export async function countTraces(): Promise<number> {
  return (await db()).count(STORE)
}

/** Drop all retained rows. */
export async function clearTraces(): Promise<void> {
  await (await db()).clear(STORE)
}

/**
 * Drop the oldest rows once the store is over its limit.
 *
 * `count` is how many to remove; the caller decides that from the limit, the size
 * of the batch that arrived and the user's eviction factor (`evictionCount` in
 * `settings.ts`). Passing it in rather than recomputing here keeps the policy in
 * one place and lets this stay a mechanism.
 */
export async function pruneOldest(count: number): Promise<number> {
  if (count <= 0) return 0
  const database = await db()
  const tx = database.transaction(STORE, 'readwrite')
  let cursor = await tx.store.index(BY_EPOCH).openCursor(null, 'next') // oldest first
  let deleted = 0
  let toDelete = count
  while (cursor && toDelete > 0) {
    await cursor.delete()
    deleted += 1
    toDelete -= 1
    cursor = await cursor.continue()
  }
  await tx.done
  return deleted
}

/** Drop oldest rows beyond `max` (default retention cap). */
export async function pruneTraces(max = TRACE_RETENTION): Promise<number> {
  const database = await db()
  const total = await database.count(STORE)
  if (total <= max) return 0
  let toDelete = total - max
  const tx = database.transaction(STORE, 'readwrite')
  let cursor = await tx.store.index(BY_EPOCH).openCursor(null, 'next') // oldest first
  let deleted = 0
  while (cursor && toDelete > 0) {
    await cursor.delete()
    deleted += 1
    toDelete -= 1
    cursor = await cursor.continue()
  }
  await tx.done
  return deleted
}
