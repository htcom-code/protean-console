# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Runtime-trace observability dashboard: KPI row, p95 latency chart, status mix,
  module metrics table, and recent-traces table.
- Live SSE stream (`/platform/traces/stream`): a single connection multiplexes
  `trace` / `metrics` / `modules` / `summary` events pushed ~1×/s, with manual
  **Connect / Disconnect** stream control (`LIVE` / `PAUSED`).
- Windowed header KPIs: the `summary` event drives the trend sub-lines (requests
  / error-rate / p95 vs the previous window) and the active-module split by
  isolation mode. Trend fields are nullable — a muted placeholder is shown
  instead of a fabricated delta when there is no previous-window baseline.
- IndexedDB trace history: retains traces across the platform ring-buffer
  eviction and page reloads, with infinite-scroll "Load older" and a two-step
  Clear (arm, then confirm).
- Virtualized module-metrics and recent-traces tables (only visible rows in the
  DOM), with header-click sort (persisted), search, and errors-only filters.
- Module detail panel: per-module status / metrics / routes drawer (the routes
  endpoint is pending, rendered as a graceful "unavailable" state).
- Login shell (stub) and persisted UI state (theme / sort) via `localStorage`,
  with a first-paint theme script that avoids a dark-mode flash.
- Empty states for the module and trace tables (config hint vs no-match).
- Data layer (`src/lib/api.ts`) mirroring the Protean control-plane records; a
  grounded sample-data fallback is shown when no platform is reachable.
- Connection-state signaling: `LIVE` / `SAMPLE DATA` / `DISCONNECTED` /
  `AUTH REQUIRED` / `PLATFORM ERROR` in the top bar, and a disconnect banner that
  keeps the last real data on screen (dimmed, marked stale with a live "updated
  Ns ago") and auto-recovers when the platform returns.
- Light / dark theme toggle.
- Project README, MIT `LICENSE`, and `docs/authentication.md` (operator
  authentication guide).
- Community health files: `CONTRIBUTING`, `CODE_OF_CONDUCT`, `SECURITY`.
- GitHub issue/PR templates, `CODEOWNERS`, `FUNDING`, and a lint + build CI
  workflow with Dependabot.

### Changed
- Transport: 5s REST polling → SSE push. N clients × 3 GETs collapse into one
  server-side tick, and the console no longer polls `/platform/modules` — which
  removes that self-observation trace pollution at the source.
- KPI header trend deltas and the isolation-mode split are now real data from the
  `summary` event (previously hardcoded placeholder values). The big tile values
  remain the platform's cumulative aggregates; the sub-line is the recent window.
- Lost connections are no longer masked: failed control-plane fetches are now
  classified (`unreachable` / `auth` 401·403 / `server`) with an 8s request
  timeout, and the console no longer silently replaces real data with mock. Mock
  data is used only for a cold start with no platform reachable.
- Palette aligned with the protean-web homepage: the neutral ramp moved from the
  olive base to the shared slate scale, the `chart-1..5` ramp is grayscale (the
  single-hue chart accent stays `--telemetry`), and a teal `--brand` token was
  added (exposed via `@theme inline`). Console status colors
  (`--ok` / `--warn` / `--crit`) are unchanged.
- Dependency maintenance (Dependabot): `vite` 8.1.5, `tailwindcss` 4.3.3,
  `@tanstack/react-virtual` 3.14.6, `lucide-react` 1.25.0, `oxlint` 1.74.0, and
  `actions/setup-node` v7 in CI.

### Removed
- Time-range selector (5m / 15m / 1h / 6h): after the SSE switch the tabs only
  relabeled the header without a query dependency, so they were dropped.

### Fixed
- The console now notices when the platform goes down mid-stream. Behind a dev
  proxy an SSE connection can be left half-open when the upstream dies — no
  `error` event fires — so the view stayed `LIVE` forever. A silence watchdog now
  flips to `DISCONNECTED` when the stream goes quiet (the platform pushes
  metrics/modules ~1×/s, so real silence is unambiguous), and the stream is
  rebuilt on a timer so it recovers to `LIVE` once the platform is back.
- Latency chart axis: replaced the fixed `[0, 25, 50, 75]` ticks with
  data-driven nice round ticks, so the labels stay evenly spread across the
  height at any scale (an outlier no longer collapses them to the bottom).
- Selected Recent-traces filter chips (`All` / `Slow`) now keep their label
  readable on hover in both light and dark themes.

### Notes
- No tagged release yet (`0.0.1`). This section tracks work toward the first
  release; move entries under a versioned heading when one is cut.

[Unreleased]: https://github.com/htcom-code/protean-console/commits/main
