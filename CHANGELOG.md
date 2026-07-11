# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Runtime-trace observability dashboard: KPI row, p95 latency chart, status mix,
  module metrics table, and recent-traces table.
- Data layer (`src/lib/api.ts`) consuming the Protean control-plane REST
  (`/platform/traces`, `/platform/traces/metrics`, `/platform/modules`) with a
  graceful mock fallback (`live: false`) when no platform is reachable.
- 5s polling refresh; time-range selector (5m / 15m / 1h / 6h); light/dark theme.
- Project README, MIT `LICENSE`, and `docs/auth-path.md` (auth design note).
- Community health files: `CONTRIBUTING`, `CODE_OF_CONDUCT`, `SECURITY`.

### Notes
- No tagged release yet (`0.0.0`). This section tracks work toward the first
  release; move entries under a versioned heading when one is cut.

[Unreleased]: https://github.com/htcom-code/protean-console/commits/main
