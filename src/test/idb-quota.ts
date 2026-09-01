/**
 * A byte budget for `fake-indexeddb`, so a full store can be tested.
 *
 * `fake-indexeddb` implements no quota at all: it accepts writes until the process
 * runs out of memory. That left the most consequential path in the trace store
 * unverifiable — the one where the browser refuses a write, the store evicts to make
 * room, and writes it again. Every other test of that path mocks our own
 * `upsertTraces` to reject, which proves what the *store* does with a rejection but
 * says nothing about whether IndexedDB can still delete when it is full. That
 * question is the whole basis of the retry.
 *
 * ## Where the budget is enforced, and why there
 *
 * Not on `IDBObjectStore.put` — that was the first attempt and it was wrong in a way
 * worth recording. Throwing from `put` raises the error *synchronously*, so the
 * caller's `Promise.all(traces.map(put))` never forms and the puts already issued in
 * that transaction reject unobserved when it aborts. The suite then drowned in
 * unhandled `AbortError`s that no browser would produce (measured: 40 of them).
 *
 * The budget is enforced instead inside `ObjectStore.storeRecord` — the operation
 * `fake-indexeddb` runs asynchronously *within* the request, which is exactly where a
 * browser's quota check lives. Throwing there makes the request fail, gives the
 * transaction that error, and aborts it: the same three events, in the same order, as
 * a real `QuotaExceededError`. Every request's promise is observed by the caller's
 * `Promise.all`, as in a browser.
 *
 * Accounting sits in the same place, so it follows the store's real contents for
 * free: `fake-indexeddb` rolls an aborted transaction back by replaying its log
 * through these very functions, and the budget follows along without any
 * transaction bookkeeping of its own.
 *
 * ## What it does and does not prove
 *
 * Exercised for real: transaction rollback, a fresh readwrite transaction opening
 * immediately after an aborted one, cursor deletes over the `byEpoch` index
 * committing while full, and the retry's second write landing in the space those
 * deletes freed.
 *
 * ## One usage rule
 *
 * The budget counts only what is written **after** `installQuota`. Records already in
 * the store are invisible to it, so a test that seeds history must seed it after
 * installing — otherwise the seed is free and the quota never bites (measured: it
 * silently made a scenario pass for the wrong reason). `used` is the honest number
 * for what this budget has seen, not for what the store holds.
 *
 * Not modelled: a browser's actual accounting (index and record overhead, page
 * granularity, per-origin eviction), and a quota that changes underfoot without the
 * test asking. Sizes here are `JSON.stringify().length`. The number is a stand-in for
 * "how much fits", so tests should derive budgets from `recordCost` rather than
 * asserting on bytes.
 */

/** What one record costs against the budget. */
export function recordCost(value: unknown): number {
  return JSON.stringify(value).length
}

export interface QuotaHandle {
  /** Bytes currently held by the store. */
  readonly used: number
  /** The budget in force. */
  readonly bytes: number
  /** How many writes have been refused since install. */
  readonly refusals: number
  /** Raise or lower the budget mid-test — a user clearing other site data. */
  resize(bytes: number): void
  /** Undo the patches. Always call this: the prototypes are shared. */
  restore(): void
}

/** `fake-indexeddb`'s internal record + object-store shapes, as far as we touch them. */
interface RawRecord {
  key?: unknown
  value?: { _key?: unknown }
}
interface RawObjectStore {
  storeRecord(record: RawRecord, noOverwrite: boolean, rollbackLog?: unknown[]): unknown
  deleteRecord(key: unknown, rollbackLog?: unknown[]): unknown
  clear(rollbackLog?: unknown[]): unknown
}
type RawProto = RawObjectStore & { __quotaPatched?: true }

export function installQuota(bytes: number): QuotaHandle {
  const txProto = IDBTransaction.prototype as unknown as {
    objectStore: (name: string) => IDBObjectStore
  }
  const realObjectStore = txProto.objectStore

  /** Sizes by primary key — the store's contents as this budget sees them. */
  const sizes = new Map<string, number>()
  let used = 0
  let budget = bytes
  let refusals = 0

  /** Prototypes patched so far, so `restore()` can put every one back. */
  const patched: Array<{ proto: RawProto; store: RawProto['storeRecord']; del: RawProto['deleteRecord']; clr: RawProto['clear'] }> = []

  function keyOf(record: RawRecord): string {
    if (record.key != null) return String(record.key)
    const inline = record.value?._key
    if (inline != null) return String(inline)
    // This app's schema is entirely in-line keyed. Guessing would mis-account
    // silently, which is worse than a loud failure in a test helper.
    throw new Error('idb-quota: cannot determine the primary key of a written record')
  }

  function patch(proto: RawProto): void {
    if (proto.__quotaPatched) return
    proto.__quotaPatched = true
    const store = proto.storeRecord
    const del = proto.deleteRecord
    const clr = proto.clear
    patched.push({ proto, store, del, clr })

    proto.storeRecord = function patchedStoreRecord(
      this: RawObjectStore,
      record: RawRecord,
      noOverwrite: boolean,
      rollbackLog?: unknown[],
    ) {
      const id = keyOf(record)
      const size = recordCost(record.value)
      const next = used - (sizes.get(id) ?? 0) + size

      // A rollback restore arrives with no rollback log of its own. Enforcing the
      // budget on it would make an abort fail to undo itself, which no browser does
      // and which would corrupt the very state the next assertion reads.
      const isUserWrite = rollbackLog !== undefined
      if (isUserWrite && next > budget) {
        refusals += 1
        // Thrown from inside the request's operation, so `fake-indexeddb` fails the
        // request with it and aborts the transaction — a browser's quota path.
        throw new DOMException(`quota of ${budget} bytes exceeded`, 'QuotaExceededError')
      }

      const result = store.call(this, record, noOverwrite, rollbackLog)
      sizes.set(id, size)
      used = next
      return result
    }

    proto.deleteRecord = function patchedDeleteRecord(this: RawObjectStore, key: unknown, rollbackLog?: unknown[]) {
      const result = del.call(this, key, rollbackLog)
      const id = String(key)
      const n = sizes.get(id)
      if (n != null) {
        sizes.delete(id)
        used -= n
      }
      return result
    }

    proto.clear = function patchedClear(this: RawObjectStore, rollbackLog?: unknown[]) {
      const result = clr.call(this, rollbackLog)
      sizes.clear()
      used = 0
      return result
    }
  }

  // Every store handle — and therefore every write, delete and cursor — is reached
  // through `transaction.objectStore()`, which makes it the one place to bootstrap
  // from. The internal prototype is not exported, so it is taken off an instance.
  txProto.objectStore = function patchedObjectStore(this: IDBTransaction, name: string) {
    const store = realObjectStore.call(this, name)
    const raw = (store as unknown as { _rawObjectStore?: RawObjectStore })._rawObjectStore
    if (raw) patch(Object.getPrototypeOf(raw) as RawProto)
    return store
  } as typeof txProto.objectStore

  return {
    get used() {
      return used
    },
    get bytes() {
      return budget
    },
    get refusals() {
      return refusals
    },
    resize(next: number) {
      budget = next
    },
    restore() {
      txProto.objectStore = realObjectStore
      for (const p of patched) {
        p.proto.storeRecord = p.store
        p.proto.deleteRecord = p.del
        p.proto.clear = p.clr
        delete p.proto.__quotaPatched
      }
      patched.length = 0
    },
  }
}
