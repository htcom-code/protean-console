import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LatencyChart } from '@/components/latency-chart'
import { StatusMix } from '@/components/status-mix'
import type { RequestTrace } from '@/lib/types'
import { useConsoleUnderTest } from '@/test/console-driver'
import { GO_CONNECT, SPRING_CONNECT } from '@/test/stream-fixtures'
import { FakeEventSource, installFakeEventSource, replay } from '@/test/sse-stream'
import { clearTraces } from '@/lib/trace-db'

/**
 * The chart is driven by whatever `deriveP95` buckets out of the live window, so
 * the shape of the series is not a free parameter — it follows from the traffic
 * the platform sent. These scenarios feed real connect sequences and assert the
 * rendered geometry, because the failure mode was invalid SVG rather than a wrong
 * number: coordinates came out `NaN` and the browser rejected the marks outright,
 * leaving an empty card and a console full of errors.
 *
 * The two fixtures land on either side of the boundary, which is why both run:
 * the Go capture's traces share one minute (one bucket, no span to interpolate
 * across), the Spring capture's straddle two.
 */

function Harness() {
  const { data } = useConsoleUnderTest()
  return data ? <LatencyChart series={data.latencyP95} /> : null
}

let restoreEventSource: () => void

beforeEach(async () => {
  restoreEventSource = installFakeEventSource()
  await clearTraces()
})

afterEach(() => {
  restoreEventSource()
})

describe.each([
  { name: 'one bucket (Go capture — all traces inside one minute)', connect: GO_CONNECT, buckets: 1 },
  { name: 'two buckets (Spring capture — traces straddle a minute)', connect: SPRING_CONNECT, buckets: 2 },
])('latency chart, $name', ({ connect, buckets }) => {
  it('renders valid coordinates', async () => {
    const { container } = render(<Harness />)

    // ① nothing rendered before the stream delivers — the marks asserted below
    //    can only come from the replayed traffic.
    expect(container.querySelector('svg')).toBeNull()

    await act(async () => {
      const es = FakeEventSource.current()
      es.emit('open')
      replay(es, connect)
    })

    const svg = await waitFor(() => {
      const found = container.querySelector('svg')
      expect(found).not.toBeNull()
      return found!
    })

    // The series really is the width this scenario claims to cover.
    const polyline = svg.querySelector('polyline')
    const pointCount = polyline ? polyline.getAttribute('points')!.trim().split(/\s+/).length : 1
    expect(pointCount).toBe(buckets)

    // Every coordinate the browser has to parse is a number.
    expect(svg.outerHTML).not.toContain('NaN')
    for (const el of svg.querySelectorAll('polyline, polygon')) {
      for (const pair of el.getAttribute('points')!.trim().split(/\s+/)) {
        const [x, y] = pair.split(',').map(Number)
        expect(Number.isFinite(x)).toBe(true)
        expect(Number.isFinite(y)).toBe(true)
      }
    }
    for (const el of svg.querySelectorAll('circle')) {
      expect(Number.isFinite(Number(el.getAttribute('cx')))).toBe(true)
      expect(Number.isFinite(Number(el.getAttribute('cy')))).toBe(true)
    }
  })

  it('draws a line only when there are two points to join', async () => {
    // With a single bucket there is no line and no area: filling from a zero
    // baseline would draw a ramp the data never measured.
    const { container } = render(<Harness />)
    await act(async () => {
      const es = FakeEventSource.current()
      es.emit('open')
      replay(es, connect)
    })
    const svg = await waitFor(() => {
      const found = container.querySelector('svg')
      expect(found).not.toBeNull()
      return found!
    })

    expect(svg.querySelector('polyline') === null).toBe(buckets < 2)
    expect(svg.querySelector('polygon') === null).toBe(buckets < 2)
    // The newest sample is marked in both cases.
    expect(svg.querySelectorAll('circle').length).toBeGreaterThanOrEqual(1)
  })
})

describe('latency chart with no samples', () => {
  // This file has no automatic cleanup (the scenarios above keep their renders), so
  // these unmount themselves — two charts in one DOM make every text query ambiguous.
  afterEach(cleanup)

  /**
   * An idle platform is the normal state of a console someone just opened, and the
   * card used to vanish on it — taking half of the row it shares with the status
   * mix and leaving a layout that looked broken rather than quiet.
   *
   * The frame is drawn instead. What must not appear with it is a shape: a line,
   * an area or a point would all be data this console never received.
   */
  it('draws the frame but nothing to read as data', () => {
    const { container } = render(<LatencyChart series={[]} />)
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg!.querySelector('polyline')).toBeNull()
    expect(svg!.querySelector('polygon')).toBeNull()
    expect(svg!.querySelector('circle'), 'marked a sample that does not exist').toBeNull()
  })

  it('says the scale is a default rather than a measurement', () => {
    // The axis numbers are this console's choice, not the platform's data. Left
    // unlabelled they read as a measured range — which is the lie the vanished
    // card at least never told.
    const { getByText } = render(<LatencyChart series={[]} />)
    expect(getByText(/default scale/)).toBeTruthy()
    expect(getByText('No samples in this window yet')).toBeTruthy()
  })

  it('goes back to the measured scale as soon as a sample lands', () => {
    const { container, getByText, rerender } = render(<LatencyChart series={[]} />)
    rerender(<LatencyChart series={[12, 40]} />)
    expect(getByText(/rolling window/)).toBeTruthy()
    expect(container.querySelector('polyline')).not.toBeNull()
  })
})

describe('status mix', () => {
  afterEach(cleanup)

  /**
   * The header count and the bar geometry were one number, and the `|| 1` that
   * keeps a width from dividing by zero was also what the header printed: an idle
   * platform read "1 req" beside four zeroes, which is a request that never
   * happened.
   */
  it('counts no requests as none', () => {
    const { getByText } = render(<StatusMix traces={[]} />)
    expect(getByText('0 req')).toBeTruthy()
  })

  it('still counts what did arrive', () => {
    const t = (status: number, seq: number): RequestTrace => ({
      seq,
      epochMillis: 1789971324000 + seq,
      method: 'GET',
      uri: '/x',
      pattern: null,
      moduleId: null,
      status,
      latencyMs: 1,
      error: null,
      traceId: `dddd${seq}`,
    })
    const { getByText } = render(<StatusMix traces={[t(200, 1), t(404, 2), t(500, 3)]} />)
    expect(getByText('3 req')).toBeTruthy()
  })
})
