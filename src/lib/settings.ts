import { readStored, writeStored } from '@/hooks/use-persistent-state'

/**
 * User settings, each in its own `pc:` localStorage key.
 *
 * Kept out of one bundled object so the two settings that already ship — `pc:theme`
 * and `pc:metricsSort` — do not have to move. Folding them in would mean a
 * migration for a console that has no version and no release, which is exactly the
 * cost this project avoids paying.
 *
 * Every value is validated on the way *out* of storage, not only on the way in.
 * `readStored` parses JSON and stops there, so a hand-edited or stale entry would
 * otherwise reach the code that trusts it — a string where the pruner expects a
 * number is enough to break retention silently.
 */

/** Floor for the retained-row limit. The UI offers this as its minimum. */
export const RETENTION_MIN = 50_000

/** How many rows to evict per over-limit batch, as a multiple of what arrived. */
export const EVICTION_FACTORS = [1, 2, 4, 8] as const
export type EvictionFactor = (typeof EVICTION_FACTORS)[number]

export interface Settings {
  /** Rows kept in IndexedDB before the oldest are evicted. */
  retention: number
  /**
   * Eviction aggressiveness. `1` removes only the overflow, which keeps the store
   * exactly at the limit and prunes on every batch once it is full. A higher factor
   * removes a multiple of the incoming batch, so the store drops below the limit and
   * the next several batches fit without pruning — at the cost of holding fewer rows
   * than the limit says.
   */
  evictionFactor: EvictionFactor
  /** Rows fetched per "load older" page. */
  pageSize: number
  /** How long a cold start waits for a platform before showing sample data. */
  sampleDelayMs: number
}

export const DEFAULT_SETTINGS: Settings = {
  retention: RETENTION_MIN,
  evictionFactor: 1,
  pageSize: 200,
  sampleDelayMs: 2500,
}

const KEYS = {
  retention: 'pc:retention',
  evictionFactor: 'pc:evictionFactor',
  pageSize: 'pc:pageSize',
  sampleDelayMs: 'pc:sampleDelayMs',
} as const

/** An integer within bounds, or `null` when the input cannot be one. */
function intIn(value: unknown, min: number, max: number): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  if (!Number.isInteger(n) || n < min || n > max) return null
  return n
}

export const BOUNDS = {
  retention: { min: RETENTION_MIN, max: 10_000_000 },
  pageSize: { min: 1, max: 2_000 },
  sampleDelayMs: { min: 500, max: 30_000 },
} as const

/** Validate one field. Returns the reason it is unusable, or null when it is fine. */
export function validate(field: keyof Settings, value: unknown): string | null {
  switch (field) {
    case 'retention':
      return intIn(value, BOUNDS.retention.min, BOUNDS.retention.max) === null
        ? `must be a whole number of at least ${RETENTION_MIN.toLocaleString('en-US')}`
        : null
    case 'pageSize':
      return intIn(value, BOUNDS.pageSize.min, BOUNDS.pageSize.max) === null
        ? `must be a whole number between ${BOUNDS.pageSize.min} and ${BOUNDS.pageSize.max.toLocaleString('en-US')}`
        : null
    case 'sampleDelayMs':
      return intIn(value, BOUNDS.sampleDelayMs.min, BOUNDS.sampleDelayMs.max) === null
        ? `must be a whole number between ${BOUNDS.sampleDelayMs.min} and ${BOUNDS.sampleDelayMs.max.toLocaleString('en-US')}`
        : null
    case 'evictionFactor':
      return (EVICTION_FACTORS as readonly number[]).includes(Number(value))
        ? null
        : `must be one of ${EVICTION_FACTORS.join(', ')}`
  }
}

/** Settings as stored, with anything unusable replaced by its default. */
export function loadSettings(): Settings {
  const raw = {
    retention: readStored<unknown>(KEYS.retention, DEFAULT_SETTINGS.retention),
    evictionFactor: readStored<unknown>(KEYS.evictionFactor, DEFAULT_SETTINGS.evictionFactor),
    pageSize: readStored<unknown>(KEYS.pageSize, DEFAULT_SETTINGS.pageSize),
    sampleDelayMs: readStored<unknown>(KEYS.sampleDelayMs, DEFAULT_SETTINGS.sampleDelayMs),
  }
  return {
    retention: validate('retention', raw.retention) === null ? Number(raw.retention) : DEFAULT_SETTINGS.retention,
    evictionFactor:
      validate('evictionFactor', raw.evictionFactor) === null
        ? (Number(raw.evictionFactor) as EvictionFactor)
        : DEFAULT_SETTINGS.evictionFactor,
    pageSize: validate('pageSize', raw.pageSize) === null ? Number(raw.pageSize) : DEFAULT_SETTINGS.pageSize,
    sampleDelayMs:
      validate('sampleDelayMs', raw.sampleDelayMs) === null
        ? Number(raw.sampleDelayMs)
        : DEFAULT_SETTINGS.sampleDelayMs,
  }
}

/** Persist every field. Callers validate first; this trusts what it is given. */
export function saveSettings(next: Settings): void {
  writeStored(KEYS.retention, next.retention)
  writeStored(KEYS.evictionFactor, next.evictionFactor)
  writeStored(KEYS.pageSize, next.pageSize)
  writeStored(KEYS.sampleDelayMs, next.sampleDelayMs)
}

/**
 * How many rows to evict when a batch pushes the store over the limit.
 *
 * `incoming` is how many rows the batch actually *added* to storage, so at factor 1
 * the count is what just arrived — which, once the store has reached the limit, is
 * exactly the overflow. Above 1 it is the larger of the overflow and
 * `incoming × factor`: the overflow still has to go, and the multiple is what buys
 * headroom so the next several batches fit without pruning.
 */
export function evictionCount(total: number, incoming: number, s: Settings): number {
  const overflow = total - s.retention
  if (overflow <= 0) return 0
  return Math.min(total, Math.max(overflow, incoming * s.evictionFactor))
}
