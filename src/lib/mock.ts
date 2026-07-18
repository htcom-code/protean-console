import type { ModuleMetricsSnapshot, ModuleStatus, RequestTrace, TraceSummary } from './types'

// Deterministic PRNG so the demo data is stable across renders/screenshots.
function makeRng(seed: number) {
  let s = seed
  return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
}

// Endpoints/modules taken from the live scenario runbooks (java_mcp SCENARIO-*.md).
const ROUTES: Array<[uri: string, pattern: string, moduleId: string | null]> = [
  ['/cp/ping', '/cp/ping', 'cp-mod'],
  ['/wk/whoami', '/wk/whoami', 'wk-calc'],
  ['/order/42', '/order/{id}', 'order-api'],
  ['/img/thumb', '/img/thumb', 'img-resize'],
  ['/order', '/order', 'order-api'],
  ['/mcp/hello', '/mcp/hello', 'mcp-hello'],
  ['/order/9/pay', '/order/{id}/pay', 'order-api'],
  ['/wk/beat', '/wk/beat', 'wk-crash'],
  ['/platform/modules', '/platform/modules', null],
]
const METHODS = ['GET', 'GET', 'POST', 'GET', 'PUT', 'GET', 'POST', 'DELETE']
const HEX = '0123456789abcdef'

export function mockTraces(now: number, count = 60): RequestTrace[] {
  const rnd = makeRng(20260711)
  const rows: RequestTrace[] = []
  let seq = 18402
  for (let i = 0; i < count; i++) {
    const [uri, pattern, moduleId] = ROUTES[Math.floor(rnd() * ROUTES.length)]
    const method =
      moduleId === 'order-api' || moduleId === 'wk-crash'
        ? METHODS[Math.floor(rnd() * METHODS.length)]
        : 'GET'
    let status = 200
    let latencyMs = Math.round(2 + rnd() * 40)
    let error: string | null = null
    const roll = rnd()
    if (moduleId === 'wk-crash' && roll > 0.4) {
      status = 502
      latencyMs = Math.round(200 + rnd() * 400)
      error = 'org.htcom.protean.bridge.BridgeInvocationException'
    } else if (moduleId === 'order-api' && roll > 0.82) {
      status = 500
      latencyMs = Math.round(150 + rnd() * 500)
      error = 'org.springframework.dao.DataAccessException'
    } else if (roll > 0.93) {
      status = 404
      latencyMs = Math.round(2 + rnd() * 8)
    } else if (moduleId === 'img-resize') {
      latencyMs = Math.round(40 + rnd() * 120)
    }
    let tid = ''
    for (let k = 0; k < 16; k++) tid += HEX[Math.floor(rnd() * 16)]
    rows.push({
      seq: seq--,
      epochMillis: now - i * 1300 - Math.floor(rnd() * 400),
      method,
      uri,
      pattern,
      moduleId,
      status,
      latencyMs,
      error,
      traceId: tid,
    })
  }
  return rows
}

export function mockMetrics(now: number): ModuleMetricsSnapshot[] {
  const mk = (
    moduleId: string,
    count: number,
    errorRate: number,
    p50: number,
    p95: number,
    p99: number,
    max: number,
    ageSec: number,
  ): ModuleMetricsSnapshot => ({
    moduleId,
    count,
    errorCount: Math.round(count * errorRate),
    errorRate,
    p50LatencyMs: p50,
    p95LatencyMs: p95,
    p99LatencyMs: p99,
    maxLatencyMs: max,
    lastSeenEpochMillis: now - ageSec * 1000,
  })
  return [
    mk('cp-mod', 9120, 0.0004, 2, 9, 22, 61, 2),
    mk('wk-calc', 4310, 0.0, 5, 18, 40, 96, 1),
    mk('order-api', 2870, 0.0512, 14, 88, 210, 640, 4),
    mk('img-resize', 1180, 0.0093, 41, 130, 305, 1120, 9),
    mk('mcp-hello', 640, 0.0, 1, 4, 8, 19, 12),
    mk('wk-crash', 210, 0.238, 8, 210, 502, 2010, 31),
    mk('(platform)', 872, 0.0011, 1, 3, 6, 24, 0),
  ]
}

export function mockModules(): ModuleStatus[] {
  const mk = (id: string, mode: string, controller: string, trustTier = 'TRUSTED'): ModuleStatus => ({
    id,
    version: '1',
    trustTier,
    desiredState: 'ACTIVE',
    controllerFqcn: controller,
    mode,
    needsSharedBeans: false,
    bridgedInterfaces: null,
  })
  return [
    mk('cp-mod', 'in-process', 'gen.PingController'),
    mk('wk-calc', 'worker', 'gen.CalcController'),
    mk('order-api', 'worker', 'gen.OrderController'),
    mk('img-resize', 'container', 'gen.ImgController', 'UNTRUSTED'),
    mk('mcp-hello', 'in-process', 'gen.HelloController'),
    mk('wk-crash', 'worker', 'gen.BeatController'),
  ]
}

// Windowed KPI header aggregate, mirroring the platform `summary` SSE event.
// Trends are populated (not null) so the sample demo shows the fully-wired header.
export function mockSummary(): TraceSummary {
  return {
    windowMs: 60000,
    count: 512,
    errorCount: 7,
    errorRate: 0.0137,
    p50LatencyMs: 12,
    p95LatencyMs: 88,
    p99LatencyMs: 210,
    maxLatencyMs: 640,
    requestsDeltaPct: 0.12,
    errorRateDeltaPp: 0.31,
    p95DeltaMs: -6,
    activeModules: 6,
    modulesByMode: { worker: 3, container: 1, 'in-process': 2 },
  }
}

// p95 latency series for the main chart (one point/minute).
export function mockLatencySeries(points = 60): number[] {
  const rnd = makeRng(90210)
  const out: number[] = []
  for (let i = 0; i < points; i++) {
    const base = 34 + Math.sin(i / 7) * 7 + rnd() * 9
    const spike = i === 41 || i === 42 ? 60 : i === 53 ? 30 : 0
    out.push(Math.round(base + spike))
  }
  return out
}
