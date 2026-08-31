/**
 * Connect sequences transcribed from both control-plane implementations,
 * captured 2026-08-31 against a Spring platform on :8080 and a Go platform
 * on :8090.
 *
 * Abridged: trace counts are cut to five (the captures carried 157 and 5) and
 * correlation ids are synthetic, because this is a public repository. Everything
 * a client can key off is left exactly as it arrived — field names and sets,
 * ordering, envelope shape, and the two platforms' differing `event:`/`event: `
 * spacing, which the parser has to tolerate either way.
 *
 * The two differ in ways that matter to the console, so scenarios run against
 * both rather than against one and a guess about the other:
 *
 *  - Spring opens with the ring-buffer dump; Go opens with a `hello` frame the
 *    console has no listener for, then the dump.
 *  - Both send the dump newest-first, as one array in one frame.
 *  - Module rows carry different fields (`controllerFqcn`/`needsSharedBeans`
 *    exist only on the JVM); `mode` is the field the console reads.
 */

/** Spring platform, :8080. `event:` with no space; no `hello` frame. */
export const SPRING_CONNECT = `event:trace
data:[{"seq":157,"epochMillis":1788159685413,"method":"GET","uri":"/notes/17","pattern":"/notes/{id}","moduleId":"note-mvc","status":200,"latencyMs":3,"error":null,"traceId":"11111111-0000-4000-8000-000000000157"},{"seq":156,"epochMillis":1788159685410,"method":"GET","uri":"/notes","pattern":"/notes","moduleId":"note-mvc","status":200,"latencyMs":0,"error":null,"traceId":"11111111-0000-4000-8000-000000000156"},{"seq":155,"epochMillis":1788159679137,"method":"GET","uri":"/notes/slug","pattern":"/notes/{id}","moduleId":"note-mvc","status":400,"latencyMs":1,"error":null,"traceId":"11111111-0000-4000-8000-000000000155"},{"seq":154,"epochMillis":1788159679135,"method":"POST","uri":"/platform/mcp","pattern":"/platform/mcp","moduleId":null,"status":200,"latencyMs":2,"error":null,"traceId":"11111111-0000-4000-8000-000000000154"},{"seq":153,"epochMillis":1788159654885,"method":"GET","uri":"/wk/beat","pattern":"/wk/beat","moduleId":"wk-crash","status":502,"latencyMs":454,"error":"BridgeInvocationException","traceId":"11111111-0000-4000-8000-000000000153"}]

event:metrics
data:[]

event:modules
data:[{"id":"note-mvc","version":"2.0.0","trustTier":"TRUSTED","desiredState":"ACTIVE","controllerFqcn":"gen.notemvc.NoteController","mode":"in-process","needsSharedBeans":false,"bridgedInterfaces":null,"boundGeneration":0,"kind":"NORMAL","exports":[],"uses":[],"boundLibraryGenerations":[],"libraryGeneration":null,"scope":null,"runtimeId":"main"}]

event:summary
data:{"windowMs":60000,"count":5,"errorCount":1,"errorRate":0.2,"p50LatencyMs":2,"p95LatencyMs":454,"p99LatencyMs":454,"maxLatencyMs":454,"requestsDeltaPct":null,"errorRateDeltaPp":null,"p95DeltaMs":null,"activeModules":1,"modulesByMode":{"in-process":1}}

`

/** Go platform, :8090. `event: ` with a space; opens with `hello`. */
export const GO_CONNECT = `event: hello
data: {"buffered":5,"metricsEnabled":true,"tracesEnabled":true}

event: trace
data: [{"seq":5,"traceId":"aaaa000000000005","moduleId":"greeter","method":"GET","uri":"/hello","pattern":"/greeter/hello","status":200,"latencyMs":0,"epochMillis":1788161788025,"error":null,"runtimeId":"worker:greeter"},{"seq":4,"traceId":"aaaa000000000004","moduleId":"greeter","method":"GET","uri":"/missing","pattern":"/greeter","status":404,"latencyMs":0,"epochMillis":1788161788013,"error":null,"runtimeId":"worker:greeter"},{"seq":3,"traceId":"aaaa000000000003","moduleId":"greeter","method":"GET","uri":"/hello","pattern":"/greeter/hello","status":200,"latencyMs":0,"epochMillis":1788161788001,"error":null,"runtimeId":"worker:greeter"},{"seq":2,"traceId":"aaaa000000000002","moduleId":"mvc-notes","method":"GET","uri":"/","pattern":"/mvc-notes/{$}","status":200,"latencyMs":0,"epochMillis":1788161787990,"error":null,"runtimeId":"worker:mvc-notes"},{"seq":1,"traceId":"aaaa000000000001","moduleId":"greeter","method":"GET","uri":"/hello","pattern":"/greeter/hello","status":200,"latencyMs":0,"epochMillis":1788161787978,"error":null,"runtimeId":"worker:greeter"}]

event: metrics
data: [{"moduleId":"greeter","count":4,"errorCount":0,"errorRate":0,"p50LatencyMs":0,"p95LatencyMs":0,"p99LatencyMs":0,"maxLatencyMs":0,"lastSeenEpochMillis":1788161788025},{"moduleId":"mvc-notes","count":1,"errorCount":0,"errorRate":0,"p50LatencyMs":0,"p95LatencyMs":0,"p99LatencyMs":0,"maxLatencyMs":0,"lastSeenEpochMillis":1788161787990}]

event: modules
data: [{"id":"greeter","version":"2","kind":"NORMAL","desiredState":"ACTIVE","mode":"worker","trustTier":"TRUSTED","mount":"/greeter","runtimeId":"worker:greeter","fileCount":1,"testCount":1},{"id":"mvc-notes","version":"3","kind":"NORMAL","desiredState":"ACTIVE","mode":"worker","trustTier":"TRUSTED","mount":"/mvc-notes","runtimeId":"worker:mvc-notes","fileCount":4,"testCount":2}]

event: summary
data: {"windowMs":60000,"count":5,"errorCount":0,"errorRate":0,"p50LatencyMs":0,"p95LatencyMs":0,"p99LatencyMs":0,"maxLatencyMs":0,"requestsDeltaPct":null,"errorRateDeltaPp":null,"p95DeltaMs":null,"activeModules":2,"modulesByMode":{"worker":2}}

`

/** Both connect sequences, for scenarios that must hold on either platform. */
export const PLATFORMS = [
  { name: 'spring', connect: SPRING_CONNECT },
  { name: 'go', connect: GO_CONNECT },
] as const

/**
 * One trace frame, newer than any fixture trace — the "and then real traffic
 * arrives" step. `atMillis` must stay above the fixtures' newest epoch.
 */
export function traceFrame(seq: number, atMillis: number): string {
  return JSON.stringify([
    {
      seq,
      epochMillis: atMillis,
      method: 'GET',
      uri: '/hello',
      pattern: '/greeter/hello',
      moduleId: 'greeter',
      status: 200,
      latencyMs: 1,
      error: null,
      traceId: `bbbb${String(seq).padStart(12, '0')}`,
    },
  ])
}

/** Newest epoch in a connect fixture — the floor for `traceFrame` timestamps. */
export const FIXTURE_NEWEST_EPOCH = 1788161788025
