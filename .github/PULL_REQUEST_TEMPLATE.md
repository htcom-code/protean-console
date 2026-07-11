<!--
Thanks for contributing to Protean Console! Keep the title in Conventional Commits
form, e.g. `fix(traces): keep client filter in sync with the range selector`.
Delete any section that does not apply.
-->

## What & why

<!-- What does this change do, and what problem does it solve? -->

## Type of change

- [ ] `fix` — bug fix (no new behaviour)
- [ ] `feat` — new capability (view, filter, chart, interaction)
- [ ] `perf` — performance, no observable behaviour change
- [ ] `docs` — documentation only
- [ ] `refactor` / `chore` / `test` / `ci` — no behaviour change

## Correctness & conventions

- [ ] HTTP stays in the data layer only (`src/lib/api.ts`); components take plain props.
- [ ] `src/lib/types.ts` still mirrors the backend `RequestTrace` /
      `ModuleMetricsSnapshot` records (updated if the surface changed).
- [ ] The LIVE / SAMPLE-DATA fallback still works (UI explorable with no platform).
- [ ] Status color is paired with an icon/label (never color alone); charts stay
      single-hue (no red/green categorical).

## Verification

- [ ] `npm run lint` passes (oxlint)
- [ ] `npm run build` passes (`tsc -b && vite build`)
- [ ] Verified in the app (`npm run dev`) — against SAMPLE data at minimum, LIVE if relevant
- [ ] Docs updated if behaviour/config changed (README, `docs/*`)

## Related

<!-- Closes #123, related issues. -->
