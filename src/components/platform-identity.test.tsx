import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ModuleTable } from '@/components/module-table'
import { TopBar } from '@/components/top-bar'
import { TraceTable } from '@/components/trace-table'
import type { TraceStoreView } from '@/hooks/use-trace-store'
import { ALL_HEALTHY, type PlatformInfo } from '@/hooks/use-console-data'
import { STORAGE_OK } from '@/hooks/use-trace-store'
import { DEFAULT_SETTINGS } from '@/lib/settings'

/**
 * What the connection ack changes on screen.
 *
 * `ready-ack.test.ts` proves the hook reads the frame; this is the hop after it.
 * Three statements the console used to make without being told anything are the
 * subject: a ring size it printed as a constant, an "enable this setting" instruction
 * it inferred from an empty array, and the identity of the platform it was talking
 * to, which it never showed at all.
 *
 * Each is asserted twice — with the ack and without it — because the failure worth
 * catching is not the stated value being wrong. It is the console going back to
 * asserting something when the platform said nothing.
 */

function info(fields: Partial<PlatformInfo> = {}): PlatformInfo {
  return {
    platform: 'protean',
    platformVersion: '0.1.0',
    tracesEnabled: true,
    metricsEnabled: false,
    buffered: 0,
    tickMs: 1000,
    capacity: 200,
    ...fields,
  }
}

function renderHeader(platform: PlatformInfo | null) {
  render(
    <TopBar
      streaming
      onToggleStream={() => {}}
      theme="dark"
      onToggleTheme={() => {}}
      conn={{ status: 'live', lastUpdated: 1788161788025 }}
      channels={ALL_HEALTHY}
      platform={platform}
      storage={STORAGE_OK}
      settings={DEFAULT_SETTINGS}
      onSaveSettings={() => {}}
    />,
  )
}

afterEach(cleanup)

describe('the buffer figure in the live badge', () => {
  it('is the capacity the platform stated', () => {
    renderHeader(info({ capacity: 5_000 }))
    expect(screen.getByText(/LIVE · 5000 buffer/)).toBeTruthy()
  })

  it('is left off entirely when no platform stated one', () => {
    // It read "LIVE · 200 buffer" on every platform, including ones whose ring was
    // a different size — a number this console had never been told and could not
    // see. Saying only LIVE is the honest version.
    renderHeader(null)
    expect(screen.getByText('LIVE')).toBeTruthy()
    expect(screen.queryByText(/buffer/)).toBeNull()
  })
})

describe('which platform answered', () => {
  it('is named next to the origin', () => {
    renderHeader(info())
    expect(screen.getByText(/protean 0\.1\.0/)).toBeTruthy()
  })

  it('says the version is unknown rather than picking one', () => {
    renderHeader(info({ platformVersion: null }))
    expect(screen.getByText(/protean \(version unknown\)/)).toBeTruthy()
  })

  it('names nothing when the platform introduced nothing', () => {
    renderHeader(null)
    expect(screen.queryByText(/protean \d/)).toBeNull()
  })
})

describe('the module table with no metrics to show', () => {
  /**
   * An empty `metrics` array is true of two different platforms: one not recording
   * per-module metrics, and one recording them that has served nothing. The console
   * used to answer for both by telling the operator to switch a setting on — which,
   * on the second platform, was already on.
   */
  function renderTable(metricsEnabled: boolean | null, tracesEnabled: boolean | null = true) {
    render(
      <ModuleTable
        metrics={[]}
        modules={[]}
        metricsEnabled={metricsEnabled}
        tracesEnabled={tracesEnabled}
        sort={{ key: 'count', dir: 'desc' }}
        onSort={() => {}}
        selectedId={null}
        onSelect={() => {}}
      />,
    )
  }

  it('says metrics are off when the platform said so', () => {
    renderTable(false)
    expect(screen.getByText('Module metrics are off')).toBeTruthy()
    expect(screen.getByText(/protean\.trace\.metrics\.enabled=false/)).toBeTruthy()
  })

  it('does not tell an operator to enable a setting that is already on', () => {
    renderTable(true)
    expect(screen.getByText('No module traffic yet')).toBeTruthy()
    expect(screen.queryByText(/=true/), 'told the operator to enable what is on').toBeNull()
  })

  it('states the ambiguity when no platform resolved it', () => {
    renderTable(null, null)
    expect(screen.getByText('No module metrics')).toBeTruthy()
    expect(screen.getByText(/did not state whether/)).toBeTruthy()
  })

  it('leads with recording being off when both are off', () => {
    // The reachable case under the contract, and the reason the ordering is not
    // optional: `metricsEnabled` is the effective value, so recording off reports
    // metrics off — and "turn it on and rows appear" would be an instruction that
    // changes nothing beside a promise nothing can keep.
    renderTable(false, false)
    expect(screen.getByText('Trace recording is off')).toBeTruthy()
    expect(screen.queryByText(/Turn it on and rows appear/), 'told the operator to flip a switch that would not help').toBeNull()
  })

  it('declines to promise rows on an ack that contradicts itself', () => {
    // `metricsEnabled: true` with `tracesEnabled: false` should not be sent — the
    // contract says the metrics flag is the effective value. The console cannot
    // verify an ack, though, so it declines the promise rather than repeating it.
    renderTable(true, false)
    expect(screen.getByText('Trace recording is off')).toBeTruthy()
    expect(screen.queryByText(/rows appear as traffic arrives/), 'promised rows that cannot come').toBeNull()
  })
})

describe('the trace table with nothing in it', () => {
  /**
   * The empty table makes a promise — "requests appear here as the platform serves
   * them". On a platform recording nothing it is a promise no request will ever
   * keep, and the operator would have waited at a table that was never going to
   * fill. `tracesEnabled` is the only thing that can tell them.
   */
  const EMPTY_STORE: TraceStoreView = {
    rows: [],
    total: 0,
    hasMore: false,
    loadingOlder: false,
    loadOlder: () => {},
    clear: () => {},
    storage: STORAGE_OK,
    filter: { chip: 'all', query: '' },
    setFilter: () => {},
    searching: false,
  }

  it('says recording is off rather than promising rows that cannot come', () => {
    render(<TraceTable store={EMPTY_STORE} tracesEnabled={false} />)
    expect(screen.getByText('Trace recording is off')).toBeTruthy()
    expect(screen.queryByText(/appear here as the platform serves them/)).toBeNull()
  })

  it('keeps the promise where it holds', () => {
    render(<TraceTable store={EMPTY_STORE} tracesEnabled={true} />)
    expect(screen.getByText('No traces yet')).toBeTruthy()
  })

  it('keeps it for a platform that stated nothing', () => {
    // No ack, no fact — and the table has no more grounds to announce an outage of
    // recording than it had before the frame existed.
    render(<TraceTable store={EMPTY_STORE} tracesEnabled={null} />)
    expect(screen.getByText('No traces yet')).toBeTruthy()
  })
})
