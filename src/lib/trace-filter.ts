import type { RequestTrace } from '@/lib/types'

/**
 * What the trace table is filtered to.
 *
 * One definition, used in two places that must agree: the IndexedDB scan that searches
 * retained history, and the render-time filter that keeps newly arriving traces in view
 * while a filter is on. Two copies of this rule would drift, and the drift would look
 * like "the row was there a second ago".
 */
export type ChipKey = 'all' | 'errors' | 'slow'

export interface TraceFilter {
  chip: ChipKey
  /** Free text matched against uri, pattern, moduleId and traceId. */
  query: string
}

export const NO_FILTER: TraceFilter = { chip: 'all', query: '' }

/** Latency above this counts as slow, in ms. */
export const SLOW_MS = 100

export function isFiltering(f: TraceFilter): boolean {
  return f.chip !== 'all' || f.query.trim() !== ''
}

export function matchesFilter(t: RequestTrace, f: TraceFilter): boolean {
  if (f.chip === 'errors' && !(t.error || t.status >= 400)) return false
  if (f.chip === 'slow' && t.latencyMs <= SLOW_MS) return false
  const needle = f.query.trim().toLowerCase()
  if (!needle) return true
  const hay = `${t.uri} ${t.pattern ?? ''} ${t.moduleId ?? ''} ${t.traceId ?? ''}`.toLowerCase()
  return hay.includes(needle)
}
