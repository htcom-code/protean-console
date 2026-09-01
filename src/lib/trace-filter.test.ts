import { describe, expect, it } from 'vitest'
import { NO_FILTER, SLOW_MS, isFiltering, matchesFilter, type TraceFilter } from '@/lib/trace-filter'
import type { RequestTrace } from '@/lib/types'

/**
 * The filter rule itself.
 *
 * It lives in one place because two callers have to agree on it: the IndexedDB scan
 * that searches retained history, and the render-time filter that keeps newly arriving
 * traces visible while a filter is on. Two copies would drift, and the drift would look
 * to an operator like a row that was there a second ago and now is not.
 */

const trace = (over: Partial<RequestTrace> = {}): RequestTrace => ({
  seq: 1,
  epochMillis: 1_700_000_000_000,
  method: 'GET',
  uri: '/hello',
  pattern: '/greeter/hello',
  moduleId: 'greeter',
  status: 200,
  latencyMs: 3,
  error: null,
  traceId: 'abc123',
  ...over,
})

const f = (over: Partial<TraceFilter> = {}): TraceFilter => ({ ...NO_FILTER, ...over })

describe('whether a filter is even active', () => {
  it('is not, by default', () => {
    expect(isFiltering(NO_FILTER)).toBe(false)
  })

  it('is, for a chip or a query', () => {
    expect(isFiltering(f({ chip: 'errors' }))).toBe(true)
    expect(isFiltering(f({ query: 'hello' }))).toBe(true)
  })

  it('is not, for whitespace someone typed and cleared', () => {
    // The store scans on every active filter, so blank-but-not-empty has to count as
    // inactive — otherwise a stray space searches 50,000 rows for nothing.
    expect(isFiltering(f({ query: '   ' }))).toBe(false)
  })
})

describe('errors only', () => {
  it('takes a 4xx or 5xx status', () => {
    expect(matchesFilter(trace({ status: 404 }), f({ chip: 'errors' }))).toBe(true)
    expect(matchesFilter(trace({ status: 500 }), f({ chip: 'errors' }))).toBe(true)
  })

  it('takes a trace carrying an error even with a 2xx status', () => {
    // The platform reports both; a handled failure that still returned 200 is exactly
    // what an operator is hunting for.
    expect(matchesFilter(trace({ status: 200, error: 'boom' }), f({ chip: 'errors' }))).toBe(true)
  })

  it('leaves a clean 2xx out', () => {
    expect(matchesFilter(trace(), f({ chip: 'errors' }))).toBe(false)
    expect(matchesFilter(trace({ status: 399 }), f({ chip: 'errors' }))).toBe(false)
  })
})

describe('slow only', () => {
  it('is exclusive at the threshold', () => {
    expect(matchesFilter(trace({ latencyMs: SLOW_MS }), f({ chip: 'slow' }))).toBe(false)
    expect(matchesFilter(trace({ latencyMs: SLOW_MS + 1 }), f({ chip: 'slow' }))).toBe(true)
  })
})

describe('the text query', () => {
  it('searches uri, pattern, module and traceId', () => {
    const t = trace({ uri: '/orders/9', pattern: '/shop/orders/{id}', moduleId: 'shop', traceId: 'ff00aa' })
    for (const q of ['orders', '{id}', 'shop', 'ff00']) {
      expect(matchesFilter(t, f({ query: q })), q).toBe(true)
    }
    expect(matchesFilter(t, f({ query: 'greeter' }))).toBe(false)
  })

  it('ignores case and surrounding space', () => {
    expect(matchesFilter(trace(), f({ query: '  GREETER  ' }))).toBe(true)
  })

  it('tolerates the nullable fields the platform may omit', () => {
    // `pattern`, `moduleId` and `traceId` are all nullable on the wire. A filter that
    // threw here would take down the table for a trace the platform is entitled to send.
    const bare = trace({ pattern: null, moduleId: null, traceId: null })
    expect(matchesFilter(bare, f({ query: 'hello' }))).toBe(true)
    expect(matchesFilter(bare, f({ query: 'greeter' }))).toBe(false)

    // 🔴 And the absent fields must not become the text "null" — searching for it would
    // then return every trace the platform sent without a pattern or module, which is a
    // false positive an operator cannot explain. Measured: dropping the `?? ''` guards
    // makes this the only failure.
    expect(matchesFilter(bare, f({ query: 'null' }))).toBe(false)
  })
})

describe('a chip and a query together', () => {
  it('requires both', () => {
    const both = f({ chip: 'errors', query: 'orders' })
    expect(matchesFilter(trace({ status: 404, uri: '/orders/1' }), both)).toBe(true)
    expect(matchesFilter(trace({ status: 404, uri: '/hello' }), both)).toBe(false)
    expect(matchesFilter(trace({ status: 200, uri: '/orders/1' }), both)).toBe(false)
  })
})
