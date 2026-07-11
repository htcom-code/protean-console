# protean-console

Standalone runtime-trace **observability console** for the Protean dynamic-module
platform. It consumes the read-only control-plane REST of any Protean-enabled Spring
app (`/platform/traces`, `/platform/traces/metrics`) — it is not coupled to any one
backend and ships nothing server-side.

## Stack

- **Vite + React + TypeScript** (SPA — authenticated internal ops tool, no SSR/SEO).
- **Tailwind v4** (`@tailwindcss/vite`), **shadcn** style `base-nova` / baseColor `olive`,
  library `@base-ui/react` (base, not radix). Tokens mirror the shared
  `design-system` project (oklch, `--ch-*`/DS conventions).
- **Fonts**: Geist (sans) + Raleway (heading), self-hosted via `@fontsource-variable/*`.
- `@/*` path alias → `./src/*` (no `baseUrl` — TS 7 resolves `paths` relative to tsconfig).

## Not applied (standalone console ≠ desktop shell)

The `create_frontend` desktop-shell parts are intentionally **out of scope** here:
importmap single-instance / `/vendor/*` bundle (§10), the esbuild multi-stage vendor
pipeline (§9), and the `@desktop/sdk` SharedWorker comms (§11). This app talks to the
platform with plain `fetch` through the Vite dev proxy.

## Conventions

- **Data layer** is the only place that knows about HTTP: `src/lib/api.ts`
  (`loadSnapshot`) + `src/lib/types.ts` (mirror the Java records `RequestTrace` /
  `ModuleMetricsSnapshot` — keep them in sync). Components take plain props.
- **Graceful fallback**: when no platform is reachable, `loadSnapshot` returns grounded
  mock data (`src/lib/mock.ts`) with `live: false` so the UI is always explorable.
  The top bar shows LIVE vs SAMPLE DATA from that flag.
- **Color**: status (ok/warn/crit) and the telemetry chart hue are extra tokens in
  `src/index.css` (`--ok/--warn/--crit/--telemetry`, exposed via `@theme inline` as
  `text-ok`, `bg-crit/14`, etc.). Status color is always paired with an icon/label —
  never color alone. Charts stay single-hue (telemetry); no red/green categorical.
- Numeric/telemetry text is monospace + `tabular-nums`.

## Commands

- `npm run dev` — dev server (proxies `/platform` → `VITE_PROTEAN_TARGET`, default :8080).
- `npm run build` — `tsc -b && vite build`.
- `npm run lint` — oxlint.

## Follow-ups (not yet wired)

- Auth: `/platform/*` may sit behind auth in prod. Design is captured in
  [docs/auth-path.md](docs/auth-path.md) (scheme-agnostic; single choke point at
  `api.ts` `getJson`) — scheme not yet chosen, not implemented.
- i18n / GA4: not set up (internal MVP).
- Server-side filtering: `errorsOnly`/`status`/`minLatencyMs` are sent as query params
  by `api.ts` but the recent-traces table currently also filters client-side.
