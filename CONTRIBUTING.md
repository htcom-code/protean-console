# Contributing to Protean Console

Thanks for taking the time to contribute! This is a React + TypeScript SPA that
observes a Protean-enabled Spring platform. This guide covers how to set up, make
changes, and open a pull request.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Getting started](#getting-started)
- [Project layout](#project-layout)
- [Branch naming](#branch-naming)
- [Commit messages](#commit-messages)
- [Before you push](#before-you-push)
- [Pull requests](#pull-requests)
- [Code style & conventions](#code-style--conventions)
- [Reporting bugs & requesting features](#reporting-bugs--requesting-features)

## Prerequisites

- **Node.js ≥ 20.19** (developed on v26)
- **npm** (the committed `package-lock.json` is the source of truth)

## Getting started

```bash
git clone git@github.com:htcom-code/protean-console.git
cd protean-console
npm ci
cp .env.example .env    # optional: set VITE_PROTEAN_TARGET
npm run dev
```

With no platform running the UI shows **SAMPLE DATA**; point `VITE_PROTEAN_TARGET`
at a live Protean app to see **LIVE** data.

## Project layout

See [README → Architecture](README.md#architecture). In short:

- `src/lib/` is the **only** place that talks HTTP (`api.ts`) or defines the data
  shape (`types.ts`, mirroring the backend Java records).
- `src/components/` are presentational and take plain props.
- `src/hooks/` hold data-loading and theme state.

## Branch naming

Use `<type>/<short-description>` — lowercase, hyphen-separated, noun-focused,
~25 chars. Types: `feat`, `fix`, `hotfix`, `refactor`, `chore`, `docs`, `test`,
`perf`, `style`, `ci`, `release`, `wip`.

```
feat/trace-filter-bar
fix/latency-bucket-off-by-one
docs/readme-quickstart
```

## Commit messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <subject>

- why the change is needed (body, wrap ~72 cols, optional)

Tags: #tag #tag        (optional, one line)
```

- **Subject**: ≤50 chars, imperative mood, lowercase, no trailing period
  (`add filter bar`, not `Added filter bar.`).
- **Types**: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `perf`.
- Keep each commit to a single logical change; split mixed changes by type.

## Before you push

Run the full local gate — these must pass:

```bash
npm run lint      # oxlint
npm run build     # tsc -b && vite build (type-check + production build)
```

If your change has a runtime effect, also verify it in the app (`npm run dev`)
against SAMPLE data at minimum.

## Pull requests

1. Branch off the latest `main`.
2. Make focused commits (above).
3. Push and open a PR against `main`.
4. Fill in the PR description with **Problem / Cause / Change / Effect**.
5. Ensure `lint` and `build` are green.

Keep PRs small and reviewable. Rebase on `main` if your branch falls behind.

## Code style & conventions

- **TypeScript**, React 19 function components + hooks.
- **Styling**: Tailwind v4 + shadcn (`base-nova` / `olive`) on `@base-ui/react`.
- **Status color** (ok/warn/crit) is always paired with an icon/label — never color
  alone. Charts stay single-hue (telemetry); no red/green categorical encoding.
- Numeric/telemetry text uses monospace + `tabular-nums`.
- Keep `src/lib/types.ts` in sync with the backend `RequestTrace` /
  `ModuleMetricsSnapshot` records.

## Reporting bugs & requesting features

Open a GitHub issue with steps to reproduce (or the expected behavior for a
feature). For **security** issues, do **not** open a public issue — see
[SECURITY.md](SECURITY.md).
