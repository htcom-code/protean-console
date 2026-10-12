import { act, cleanup, render, renderHook, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { KpiRow } from '@/components/kpi-row'
import { useConsoleData } from '@/hooks/use-console-data'
import type { ModuleMetricsSnapshot, TraceSummary } from '@/lib/types'
import { GO_CONNECT, PROTEAN_CONNECT, SPRING_CONNECT } from '@/test/stream-fixtures'
import { FakeEventSource, installFakeEventSource, parseStream, replay } from '@/test/sse-stream'

/**
 * The request and error-rate tiles are sums over `metrics`. An empty array sums to
 * zero whether or not anything was recorded, and a platform with per-module metrics
 * off sends exactly that — measured live on 2026-10-12: quickstart under a
 * 3,000-request burst, and the header read "Requests · total 0" and "0.00%".
 *
 * The ack already says which case it is, and the module table already reads it.
 * These scenarios hold the tiles to the same reading, and replay real connect
 * sequences so the ack is the one a platform actually sends.
 */

afterEach(cleanup)

function value(label: string): string {
  return screen.getByText(label).nextElementSibling!.textContent!
}

function subline(label: string): string {
  return screen.getByText(label).parentElement!.lastElementChild!.textContent!
}

const row = (count: number, errorCount: number): ModuleMetricsSnapshot => ({
  moduleId: 'greeter',
  count,
  errorCount,
  errorRate: count ? errorCount / count : 0,
  p50LatencyMs: 1,
  p95LatencyMs: 2,
  p99LatencyMs: 3,
  maxLatencyMs: 4,
  lastSeenEpochMillis: 1_790_000_000_000,
})

describe('on a live connect sequence', () => {
  let restoreEventSource: () => void
  beforeEach(() => {
    restoreEventSource = installFakeEventSource()
  })
  afterEach(() => restoreEventSource())

  function connect(body: string) {
    const { result } = renderHook(() => useConsoleData())
    act(() => {
      const es = FakeEventSource.current()
      es.emit('open')
      replay(es, body)
    })
    const { data, platform } = result.current
    render(
      <KpiRow
        metrics={data!.metrics}
        summary={data!.summary}
        metricsEnabled={platform?.metricsEnabled ?? null}
        tracesEnabled={platform?.tracesEnabled ?? null}
      />,
    )
  }

  it('says metrics are off, not that nothing happened, on a platform that turned them off', () => {
    // 🔴 The protean capture: `metricsEnabled: false`, `metrics: []`, and a summary
    // counting traffic. The tiles used to print a confident zero over it.
    connect(PROTEAN_CONNECT)
    expect(value('Requests · total')).toMatch(/^—\smetrics\soff$/)
    expect(value('Error rate')).toMatch(/^—\smetrics\soff$/)
    // The windowed trend is a different measurement, and it is still there.
    expect(subline('Requests · total')).toContain('vs prev')
  })

  it('says it was not told, on a platform that sends no ack and no rows', () => {
    connect(SPRING_CONNECT)
    expect(value('Requests · total')).toMatch(/^—\snot\sreported$/)
  })

  it('shows the totals a platform did send', () => {
    // Go sends module rows (and an older `hello`, not `ready`): the rows are data.
    connect(GO_CONNECT)
    const rows = JSON.parse(parseStream(GO_CONNECT).find((f) => f.event === 'metrics')!.data) as ModuleMetricsSnapshot[]
    expect(value('Requests · total')).toBe(String(rows.reduce((a, r) => a + r.count, 0)))
    expect(value('Requests · total')).not.toMatch(/off|not reported/)
  })
})

describe('the reading, case by case', () => {
  const summary = JSON.parse(parseStream(PROTEAN_CONNECT).find((f) => f.event === 'summary')!.data) as TraceSummary

  it('names recording before metrics, as the module table does', () => {
    // `metricsEnabled` is the effective value, so recording off reports metrics off
    // too; "metrics off" would point at the wrong switch.
    render(<KpiRow metrics={[]} summary={summary} metricsEnabled={false} tracesEnabled={false} />)
    expect(value('Requests · total')).toMatch(/^—\srecording\soff$/)
  })

  it('keeps a true zero: metrics on and no traffic yet', () => {
    render(<KpiRow metrics={[]} summary={summary} metricsEnabled tracesEnabled />)
    expect(value('Requests · total')).toBe('0')
    expect(value('Error rate')).toBe('0.00%')
  })

  it('shows rows that arrived even if the ack said off', () => {
    // The setting is live: it can be switched on after the ack. Rows are data.
    render(<KpiRow metrics={[row(40, 4)]} summary={summary} metricsEnabled={false} tracesEnabled />)
    expect(value('Requests · total')).toBe('40')
    expect(value('Error rate')).toBe('10.00%')
  })

  it('does not invent an error count when there is no summary either', () => {
    render(<KpiRow metrics={[]} summary={null} metricsEnabled={false} tracesEnabled />)
    expect(value('Error rate')).toMatch(/^—\smetrics\soff$/)
    expect(subline('Error rate')).not.toMatch(/\d+ err/)
  })
})
