# Auth path (design)

Status: **design only — not implemented.** This records how the console will send
credentials to a secured platform, and the single place to wire it, so implementation
is a small, localized change when a target auth scheme is chosen.

## Context

Protean does not impose REST auth on `/platform/**` by default — it delegates to the
consuming app (typically Spring Security). So the console's job is only to **attach a
credential** to its outbound requests, in a scheme the target platform accepts.

## The single choke point

Every control-plane request goes through **one** function: `getJson` in
`src/lib/api.ts` (used by `loadSnapshot` for `/traces`, `/traces/metrics`, `/modules`).
Auth is added there and nowhere else.

```
loadSnapshot ──▶ getJson(path) ──▶ fetch(`/platform${path}`, { headers })
                                        ▲
                                        └── inject auth headers here
```

## Design

Introduce an **auth-header provider** — a function `() => Record<string,string>` — that
`getJson` merges into the request headers. Swapping the provider is the only change
needed to support a different scheme:

| Scheme | Provider returns | Extra work |
|---|---|---|
| Bearer token | `{ Authorization: \`Bearer ${token}\` }` | token source (below) |
| Custom API key | `{ [headerName]: key }` | configurable header name |
| OAuth2 | `{ Authorization: \`Bearer ${accessToken}\` }` | **login/redirect + token refresh flow** (largest) |

**Token source (for Bearer / API key):**
- Runtime: read from `localStorage` (set via a small token field in the top bar). This
  keeps secrets out of the build.
- Dev convenience: fall back to `import.meta.env.VITE_PROTEAN_TOKEN` (see `.env.example`).
- **Empty → send no auth header**, so the console still works against an unsecured
  platform (same as today).

**Dev proxy:** the Vite `/platform` proxy forwards request headers as-is, so the auth
header reaches the target with no proxy change.

## Security rules

- Never bake a token into the build — runtime (`localStorage`) or gitignored `.env` only.
- On a 401/403, surface a clear "authentication required / token rejected" state in the
  top bar (reuse the LIVE/SAMPLE badge area) rather than silently falling back to mock.
- OAuth2, if chosen, adds a redirect/callback route and token storage/refresh — treat as
  its own task, not a header swap.

## Not decided

Which scheme to support (Bearer / API key / OAuth2) is still open. This note is
scheme-agnostic up to the provider; pick the scheme, implement the provider + token
source, and add the 401/403 surface.
