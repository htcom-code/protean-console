# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Runtime-trace observability dashboard: KPI row, p95 latency chart, status mix,
  module metrics table, and recent-traces table.
- Data layer (`src/lib/api.ts`) consuming the Protean control-plane REST
  (`/platform/traces`, `/platform/traces/metrics`, `/platform/modules`).
- Connection-state signaling: `LIVE` / `SAMPLE DATA` / `DISCONNECTED` /
  `AUTH REQUIRED` / `PLATFORM ERROR` in the top bar, and a disconnect banner that
  keeps the last real data on screen (dimmed, marked stale with a live "updated
  Ns ago") and auto-recovers when the platform returns.
- 5s polling refresh; time-range selector (5m / 15m / 1h / 6h); light/dark theme.
- Project README, MIT `LICENSE`, and `docs/auth-path.md` (auth design note).
- Community health files: `CONTRIBUTING`, `CODE_OF_CONDUCT`, `SECURITY`.
- GitHub issue/PR templates, `CODEOWNERS`, `FUNDING`, and a lint + build CI
  workflow with Dependabot.

### Changed
- Lost connections are no longer masked: failed control-plane fetches are now
  classified (`unreachable` / `auth` 401·403 / `server`) with an 8s request
  timeout, and the console no longer silently replaces real data with mock. Mock
  data is used only for a cold start with no platform reachable. A single dropped
  poll is tolerated before the view flips to disconnected.

### Fixed
- Selected Recent-traces filter chips (`All` / `Slow`) now keep their label
  readable on hover in both light and dark themes.

### Notes
- No tagged release yet (`0.0.0`). This section tracks work toward the first
  release; move entries under a versioned heading when one is cut.

[Unreleased]: https://github.com/htcom-code/protean-console/commits/main
