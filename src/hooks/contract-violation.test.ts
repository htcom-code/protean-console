import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useConsoleData } from '@/hooks/use-console-data'
import { PLATFORMS } from '@/test/stream-fixtures'
import { FakeEventSource, installFakeEventSource, replay } from '@/test/sse-stream'

/**
 * What the console does when a platform breaks the wire contract.
 *
 * This is not hypothetical. On 2026-08-31 a control plane published module
 * lifecycle notices under the same event name as its 1Hz module list, so a module
 * update put `{"swapped":"greeter","version":"2"}` on a channel the console reads
 * as `ModuleStatus[]`. `modules.map is not a function` reached the error boundary
 * and the whole screen became "Something went wrong" — every panel, including the
 * ones whose data was perfectly fine. The platform was fixed; the console's
 * response to one malformed frame was not.
 *
 * The payloads below are the ones actually observed, so these scenarios say what
 * the console should do about a lying platform, which is: keep the last good data
 * and stay on screen.
 */

let restoreEventSource: () => void

beforeEach(() => {
  restoreEventSource = installFakeEventSource()
})

afterEach(() => {
  restoreEventSource()
})

/** Frames a platform is not supposed to send, and did. */
const MALFORMED = [
  { what: 'a lifecycle object on the modules channel', event: 'modules', data: '{"swapped":"greeter","version":"2"}' },
  { what: 'a single trace instead of a batch', event: 'trace', data: '{"seq":1,"traceId":"x","epochMillis":1788161788999,"status":200,"latencyMs":0}' },
  { what: 'an enveloped metrics array', event: 'metrics', data: '{"metrics":[]}' },
  { what: 'a bare string', event: 'modules', data: '"greeter"' },
  { what: 'a number', event: 'summary', data: '42' },
  { what: 'truncated JSON', event: 'modules', data: '[{"id":"greeter"' },
] as const

const CHANNELS = ['trace', 'metrics', 'modules', 'summary'] as const

/** One malformed frame per channel, for the "keeps sending" scenarios. */
const MALFORMED_CHANNELS = [
  { channel: 'modules', data: '{"swapped":"greeter","version":"2"}' },
  { channel: 'trace', data: '{"seq":1,"traceId":"x","epochMillis":1788161788999}' },
  { channel: 'metrics', data: '{"metrics":[]}' },
  { channel: 'summary', data: '[]' },
] as const

/** A frame each channel accepts, for asserting the mark clears. */
const GOOD_FRAME: Record<(typeof CHANNELS)[number], string> = {
  trace: '[{"seq":7,"epochMillis":1788161789999,"method":"GET","uri":"/hello","pattern":"/greeter/hello","moduleId":"greeter","status":200,"latencyMs":0,"error":null,"traceId":"cccc000000000007"}]',
  metrics: '[]',
  modules: '[]',
  summary:
    '{"windowMs":60000,"count":0,"errorCount":0,"errorRate":0,"p50LatencyMs":0,"p95LatencyMs":0,"p99LatencyMs":0,"maxLatencyMs":0,"requestsDeltaPct":null,"errorRateDeltaPp":null,"p95DeltaMs":null,"activeModules":0,"modulesByMode":{}}',
}

describe.each(PLATFORMS)('$name platform', ({ connect }) => {
  describe.each(MALFORMED)('$what', ({ event, data }) => {
    it('does not take the console down, and keeps the last good data', () => {
      const { result } = renderHook(() => useConsoleData())

      act(() => {
        const es = FakeEventSource.current()
        es.emit('open')
        replay(es, connect)
      })
      const good = result.current.data
      expect(good).not.toBeNull()
      const goodModules = good!.modules
      const goodTraces = good!.traces

      // The malformed frame arrives. Delivering it must not throw out of the
      // listener: an exception here escapes to the error boundary and replaces the
      // entire screen, discarding panels whose own data was fine.
      expect(() =>
        act(() => {
          FakeEventSource.current().emit(event, data)
        }),
      ).not.toThrow()

      // Still connected, still holding what the platform last said correctly.
      expect(result.current.conn.status).toBe('live')
      expect(Array.isArray(result.current.data?.modules)).toBe(true)
      expect(Array.isArray(result.current.data?.traces)).toBe(true)
      if (event === 'modules') expect(result.current.data?.modules).toEqual(goodModules)
      if (event === 'trace') expect(result.current.data?.traces).toEqual(goodTraces)

      // One bad frame is an incident, not an outage: nothing is marked stale yet.
      expect(Object.values(result.current.channels).some((c) => c.stale)).toBe(false)
      // But it is counted, so the badge can report that a frame was dropped at all.
      expect(Object.values(result.current.channels).reduce((n, c) => n + c.total, 0)).toBe(1)

      // And a well-formed frame afterwards is still accepted — one bad frame must
      // not wedge the channel.
      act(() => {
        FakeEventSource.current().emit('modules', '[{"id":"after","version":"9","mode":"worker","trustTier":"TRUSTED","desiredState":"ACTIVE"}]')
      })
      expect(result.current.data?.modules.map((m) => m.id)).toEqual(['after'])
    })
  })

  describe.each(MALFORMED_CHANNELS)('a channel that keeps sending unreadable frames ($channel)', ({ channel, data }) => {
    it('marks only that channel stale, and clears the mark on a good frame', () => {
      const { result } = renderHook(() => useConsoleData())
      act(() => {
        const es = FakeEventSource.current()
        es.emit('open')
        replay(es, connect)
      })

      // ① two is still under tolerance — the panel must not cry wolf.
      act(() => {
        FakeEventSource.current().emit(channel, data)
        FakeEventSource.current().emit(channel, data)
      })
      expect(result.current.channels[channel].stale).toBe(false)
      expect(result.current.channels[channel].rejected).toBe(2)

      // ② the third crosses it: this panel is no longer current and says so.
      act(() => {
        FakeEventSource.current().emit(channel, data)
      })
      expect(result.current.channels[channel].stale).toBe(true)

      // ③ and no other channel is implicated — their data arrived fine.
      for (const other of CHANNELS.filter((c) => c !== channel)) {
        expect(result.current.channels[other].stale).toBe(false)
      }

      // ④ one correct frame and the mark is gone. Claiming staleness after the
      //   platform has recovered is its own false statement.
      act(() => {
        FakeEventSource.current().emit(channel, GOOD_FRAME[channel])
      })
      expect(result.current.channels[channel].stale).toBe(false)
      expect(result.current.channels[channel].rejected).toBe(0)
      // The total is kept: those frames were dropped, and that happened.
      expect(result.current.channels[channel].total).toBe(3)
    })
  })
})
