import { useConsoleData } from '@/hooks/use-console-data'
import { useTraceStore } from '@/hooks/use-trace-store'
import type { RequestTrace } from '@/lib/types'
import { DEFAULT_SETTINGS, type Settings } from '@/lib/settings'

const NO_TRACES: RequestTrace[] = []

/**
 * The composition `App` performs, and nothing else — the stream hook feeding the
 * trace store, with the same `persist` rule. Scenarios drive this so they exercise
 * the wiring rather than each hook in isolation; a defect that only appears when
 * the two are connected (the whole live window being re-persisted on every event,
 * for instance) is invisible to a test that mounts them separately.
 *
 * Keep in step with `App.tsx`: if the composition there changes, this changes.
 */
export function useConsoleUnderTest(settings: Settings = DEFAULT_SETTINGS) {
  const { data, conn, streaming, setStreaming } = useConsoleData(settings)
  const persist = conn.status === 'live' || conn.status === 'disconnected' || conn.status === 'paused'
  const store = useTraceStore(data?.traces ?? NO_TRACES, persist, settings)
  return { data, conn, store, streaming, setStreaming }
}
