/**
 * Fake SSE endpoint for the scenario tests.
 *
 * `useConsoleData` constructs `new EventSource(url)` off the global, which is the
 * only seam these tests need: swapping the global lets a scenario feed the real
 * hook the bytes a real platform sends, with no production code aware of it.
 *
 * Payloads come from `stream-fixtures.ts` — transcriptions of streams captured
 * from both platforms — so a scenario asserts against the wire, not against a
 * mock of our own understanding of it.
 */

type Listener = (event: { data?: string }) => void

export class FakeEventSource {
  /** Every instance built since `installFakeEventSource`, oldest first. */
  static instances: FakeEventSource[] = []

  readonly url: string
  closed = false
  private readonly listeners = new Map<string, Set<Listener>>()

  constructor(url: string) {
    this.url = url
    FakeEventSource.instances.push(this)
  }

  addEventListener(type: string, fn: Listener): void {
    const set = this.listeners.get(type) ?? new Set<Listener>()
    set.add(fn)
    this.listeners.set(type, set)
  }

  removeEventListener(type: string, fn: Listener): void {
    this.listeners.get(type)?.delete(fn)
  }

  close(): void {
    this.closed = true
  }

  /** Deliver one named event, exactly as the browser would. */
  emit(type: string, data?: string): void {
    if (this.closed) throw new Error(`emit("${type}") on a closed EventSource`)
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn({ data })
  }

  /** The stream the hook is currently listening on — the newest live instance. */
  static current(): FakeEventSource {
    const live = FakeEventSource.instances.filter((es) => !es.closed)
    const es = live[live.length - 1]
    if (!es) throw new Error('no open EventSource — did the hook mount?')
    return es
  }
}

/** Swap the global `EventSource`; returns a restore function. */
export function installFakeEventSource(): () => void {
  const original = (globalThis as { EventSource?: unknown }).EventSource
  FakeEventSource.instances = []
  ;(globalThis as { EventSource?: unknown }).EventSource = FakeEventSource
  return () => {
    ;(globalThis as { EventSource?: unknown }).EventSource = original
    FakeEventSource.instances = []
  }
}

/** One `event:`/`data:` pair from an SSE body. */
export interface StreamFrame {
  event: string
  data: string
}

/**
 * Parse an SSE body into frames, so a fixture can be the captured text itself
 * rather than a hand-built array. Comment lines (`: keep-alive`) are dropped, as
 * the browser drops them: they fire no listener.
 */
export function parseStream(body: string): StreamFrame[] {
  const frames: StreamFrame[] = []
  for (const block of body.split(/\n{2,}/)) {
    let event: string | null = null
    const dataLines: string[] = []
    for (const line of block.split('\n')) {
      if (line.startsWith(':') || line.trim() === '') continue
      const m = /^(event|data):\s?(.*)$/.exec(line)
      if (!m) continue
      if (m[1] === 'event') event = m[2].trim()
      else dataLines.push(m[2])
    }
    if (event) frames.push({ event, data: dataLines.join('\n') })
  }
  return frames
}

/** Replay a captured SSE body onto a stream, in order. */
export function replay(es: FakeEventSource, body: string): StreamFrame[] {
  const frames = parseStream(body)
  for (const f of frames) es.emit(f.event, f.data)
  return frames
}

/** The traces carried by a body's `trace` frames, in arrival order. */
export function tracesIn(body: string): Array<{ seq: number; traceId: string | null; epochMillis: number }> {
  return parseStream(body)
    .filter((f) => f.event === 'trace')
    .flatMap((f) => JSON.parse(f.data) as Array<{ seq: number; traceId: string | null; epochMillis: number }>)
}
