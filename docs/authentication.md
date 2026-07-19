# Authentication

> **Guide for operators.** The console ships **auth-agnostic**. Protean does not
> impose authentication on `/platform/**` — it delegates that to the consuming
> Spring application — so **how the console authenticates is yours to decide**,
> to match the auth scheme your Protean deployment already enforces. This guide
> shows where and how to wire that in.

## Why this is your call

Protean exposes the control-plane REST surface (`/platform/traces`,
`/platform/traces/metrics`, `/platform/modules`) without mandating an auth
scheme; the consuming app (typically Spring Security) owns that policy. As a
result there is no single "correct" credential for the console to send — it
depends entirely on how *your* platform is secured. The console's only job is to
attach whatever credential your deployment expects to its outbound requests.

If your platform leaves `/platform/**` open (e.g. a trusted internal network),
you need to do nothing: the console works as-is.

## Where to wire it — the single choke point

Every control-plane request passes through **one** function: `getJson` in
`src/lib/api.ts` (used by `loadSnapshot` for `/traces`, `/traces/metrics`, and
`/modules`). Add authentication **only here** — nowhere else.

```
loadSnapshot ──▶ getJson(path) ──▶ fetch(`/platform${path}`, { headers })
                                        ▲
                                        └── inject the auth header here
```

## The extension point

Introduce an **auth-header provider** — a `() => Record<string, string>`
function — and have `getJson` merge its result into the request headers. To
support a different scheme, you swap only the provider.

| Scheme | Header the provider sets | Extra work |
|---|---|---|
| Bearer token | `Authorization: Bearer <token>` | a token source (below) |
| Custom API key | `<header-name>: <key>` | a configurable header name |
| OAuth2 | `Authorization: Bearer <access-token>` | **login/redirect + token refresh flow** (the largest) |

### Token source (Bearer / API key)

- **Runtime:** read it from `localStorage` (set via a small token field in the
  top bar). This keeps the secret out of the build.
- **Dev convenience:** fall back to `import.meta.env.VITE_PROTEAN_TOKEN` (see
  `.env.example`).
- **Empty ⇒ send no auth header.** The console keeps working against an
  unsecured platform (the current behavior).

### Dev proxy

The Vite `/platform` proxy forwards request headers unchanged, so the auth
header reaches the target without any proxy change.

## Security rules

- **Never bake a token into the build** — use runtime (`localStorage`) or a
  gitignored `.env` only.
- On **401/403**, do not silently fall back to sample data — surface an explicit
  "auth required / token rejected" state in the top bar (reuse the
  `LIVE` / `SAMPLE DATA` badge area; the console already classifies `auth`
  responses).
- If you choose **OAuth2**, the redirect/callback route and token storage +
  refresh are a separate piece of work, not a header swap.

## Status

Not yet implemented. The scheme (Bearer / API key / OAuth2) is intentionally
left open — everything up to the provider point is scheme-agnostic. To turn this
guide into working auth: pick a scheme, implement the provider + token source,
and add the 401/403 surface.
