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
 *    console has no listener for, then the dump. Protean has since replaced both
 *    openings with a `ready` ack — see `PROTEAN_CONNECT` below, and note that the
 *    two captures are kept as they are: platforms that send no ack still exist
 *    (Go and Rust have not adopted it), and that is an axis worth testing.
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

/**
 * Protean (Java) with the `ready` ack — captured 2026-09-21 against
 * `examples/quickstart` on :8080 (in-process mode, H2), running protean `237bcd0`
 * (#80, `feat(web): ack a console stream connection with a ready frame`).
 *
 * Abridged the same way as the two captures above: correlation ids are synthetic
 * because this is a public repository. Everything else is the bytes as they
 * arrived — `event:ready` with no space after the colon, the ack ahead of the
 * replay, and `buffered` equal to the number of rows in the `trace` frame that
 * follows it (5 and 5, asserted in `ready-ack.test.ts`).
 *
 * Two values here are the platform as it really runs, not as a contract example
 * would draw it, and both are worth keeping:
 *
 *  - `platformVersion` is `0.1.0-SNAPSHOT` — a development build. The console
 *    prints it and does not compare it: the only released version, `0.0.1`, sends
 *    no ack at all, and a `-SNAPSHOT` sorts *below* the release it precedes.
 *  - `metricsEnabled` is `false`, quickstart's default, with an empty `metrics`
 *    frame behind it. That pairing is the one the console used to misread as
 *    "enable this setting" when it was already on.
 */
export const PROTEAN_CONNECT = `event:ready
data:{"platform":"protean","platformVersion":"0.1.0-SNAPSHOT","tracesEnabled":true,"metricsEnabled":false,"buffered":5,"tickMs":1000,"capacity":200}

event:trace
data:[{"seq":5,"epochMillis":1789971324093,"method":"GET","uri":"/platform/mcp","pattern":"/**","moduleId":null,"status":404,"latencyMs":0,"error":null,"traceId":"cccc0000-0000-4000-8000-000000000005"},{"seq":4,"epochMillis":1789971324089,"method":"POST","uri":"/platform/mcp","pattern":"/**","moduleId":null,"status":404,"latencyMs":0,"error":null,"traceId":"cccc0000-0000-4000-8000-000000000004"},{"seq":3,"epochMillis":1789971324080,"method":"POST","uri":"/platform/mcp","pattern":"/**","moduleId":null,"status":404,"latencyMs":3,"error":null,"traceId":"cccc0000-0000-4000-8000-000000000003"},{"seq":2,"epochMillis":1789971283514,"method":"GET","uri":"/platform/modules","pattern":"/platform/modules","moduleId":null,"status":200,"latencyMs":0,"error":null,"traceId":"cccc0000-0000-4000-8000-000000000002"},{"seq":1,"epochMillis":1789971283503,"method":"GET","uri":"/platform/modules","pattern":"/platform/modules","moduleId":null,"status":200,"latencyMs":21,"error":null,"traceId":"cccc0000-0000-4000-8000-000000000001"}]

event:metrics
data:[]

event:modules
data:[{"id":"sample-data-access","version":"1","trustTier":"TRUSTED","desiredState":"ACTIVE","controllerFqcn":"sample.items.ItemController","mode":"in-process","needsSharedBeans":false,"bridgedInterfaces":null,"boundGeneration":0,"kind":"NORMAL","exports":[],"uses":[],"boundLibraryGenerations":[],"libraryGeneration":null,"scope":null,"runtimeId":"main"}]

event:summary
data:{"windowMs":60000,"count":3,"errorCount":0,"errorRate":0.0,"p50LatencyMs":0,"p95LatencyMs":3,"p99LatencyMs":3,"maxLatencyMs":3,"requestsDeltaPct":0.5,"errorRateDeltaPp":0.0,"p95DeltaMs":-18,"activeModules":1,"modulesByMode":{"in-process":1}}

`

/**
 * Every connect sequence, for scenarios that must hold on any platform.
 *
 * `newestEpoch` is that fixture's newest trace, because "and then real traffic
 * arrives" means newer than *this* capture — and the three were taken weeks
 * apart. A scenario that loops over these must take the epoch from the row it is
 * running, not from a single constant: the protean capture is three weeks newer
 * than the other two, so one shared floor would make traffic "arrive" before the
 * replay it follows on two of the three.
 */
export const PLATFORMS = [
  { name: 'protean', connect: PROTEAN_CONNECT, newestEpoch: 1789971324093 },
  { name: 'spring', connect: SPRING_CONNECT, newestEpoch: 1788159685413 },
  { name: 'go', connect: GO_CONNECT, newestEpoch: 1788161788025 },
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

/**
 * Newest epoch in the **Go** capture — the floor for `traceFrame` timestamps in
 * scenarios that replay `GO_CONNECT` alone.
 *
 * Deliberately not the newest of all three. Scenarios that seed synthetic history
 * around this value and then assert which rows get evicted need that history to
 * sit next to the replayed rows on the same timeline; anchoring it to a capture
 * three weeks later would put every seeded row above every replayed one and quietly
 * change what those tests are measuring (measured: two of them then failed). A
 * scenario running against several platforms takes `newestEpoch` from `PLATFORMS`.
 */
export const FIXTURE_NEWEST_EPOCH = 1788161788025
