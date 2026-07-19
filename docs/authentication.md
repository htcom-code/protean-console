# Authentication

> **Guide for operators.** The console ships **auth-agnostic**. Protean does not
> impose authentication on `/platform/**` — it delegates that to the consuming
> Spring application — so **how the console authenticates is yours to decide**,
> to match the auth scheme your Protean deployment already enforces. This guide
> shows where and how to wire that in.

## Why this is your call

Protean exposes the control-plane surface (`/platform/traces`,
`/platform/traces/metrics`, `/platform/modules`, and the SSE stream
`/platform/traces/stream`) without mandating an auth scheme; the consuming app
(typically Spring Security) owns that policy. There is no single "correct"
credential for the console to send — it depends entirely on how *your* platform
is secured. The console's only job is to attach whatever credential your
deployment expects to its outbound requests.

If your platform leaves `/platform/**` open (e.g. a trusted internal network),
you need to do nothing: the console works as-is.

## Two paths, two mechanisms

The console reaches the platform two ways, and they authenticate **differently** —
this is the part to get right:

| Path | Where | Transport | Can send headers? |
|---|---|---|---|
| **SSE stream** (primary, live) | `src/hooks/use-console-data.ts` | `EventSource` | **No** |
| **REST** (fallback + module-routes drawer) | `src/lib/api.ts` (`getJson`) | `fetch` | Yes |

Wiring auth on the `fetch` path is easy; the SSE stream is the one that needs
care, because `EventSource` cannot set an `Authorization` header.

## REST requests — the `getJson` choke point

The REST fallback (`fetchSnapshot`) and the module-routes drawer
(`getModuleRoutes`) both pass through **one** function: `getJson` in
`src/lib/api.ts`. Add the credential here and both are covered.

```
fetchSnapshot ──▶ getJson(path) ──▶ fetch(`/platform${path}`, { headers })
                                         ▲
                                         └── inject the auth header here
```

Introduce an **auth-header provider** — a `() => Record<string, string>`
function — and have `getJson` merge its result into the request headers. To
support a different scheme you swap only the provider.

| Scheme | Header the provider sets | Extra work |
|---|---|---|
| Bearer token | `Authorization: Bearer <token>` | a token source (below) |
| Custom API key | `<header-name>: <key>` | a configurable header name |
| OAuth2 | `Authorization: Bearer <access-token>` | **login/redirect + token refresh flow** (the largest) |

**Token source (Bearer / API key):**
- **Runtime:** read it from `localStorage` (set via a small token field in the
  top bar). This keeps the secret out of the build.
- **Dev convenience:** fall back to `import.meta.env.VITE_PROTEAN_TOKEN` (see
  `.env.example`).
- **Empty ⇒ send no auth header.** The console keeps working against an
  unsecured platform (the current behavior).

## The SSE stream — `EventSource` cannot send headers

The **primary** live path is the SSE stream `/platform/traces/stream`, opened
with the browser `EventSource` API in `src/hooks/use-console-data.ts`. It does
**not** go through `getJson`, and `EventSource` **cannot set request headers** —
so the header provider above does not reach the stream. Authenticate it one of
these ways instead:

- **Session cookie — recommended.** The stream is same-origin through the Vite
  `/platform` proxy, so a cookie set by the consuming app's Spring Security is
  sent automatically with no client change. Cross-origin (no proxy) needs
  `new EventSource(url, { withCredentials: true })` plus the platform's CORS
  `Access-Control-Allow-Credentials: true`. No token handling in the client —
  the cleanest fit, and it also covers the `fetch` path (send `credentials:
  'include'`).
- **Query-param token.** Append `?access_token=…` to `STREAM_URL`. Simple, but
  the token then lands in URLs and access logs — treat it as lower-security and
  short-lived.
- **Header-capable SSE.** Replace `EventSource` with a `fetch`-based SSE reader
  (a `ReadableStream`, e.g. `@microsoft/fetch-event-source`) so the same header
  provider covers the stream too. This is the largest change — do it only when a
  header-based scheme is mandatory and cookies are not an option.

> **401/403 on the stream is not observable.** `EventSource` does not expose the
> HTTP status on failure, so a rejected stream surfaces only as a generic
> `unreachable` disconnect (see the note in `use-console-data.ts`). The explicit
> "auth required" signal in the next section therefore applies to the **REST
> path only**; on the stream, an auth failure looks the same as the platform
> being down.

## Dev proxy

The Vite `/platform` proxy forwards request headers and cookies unchanged, so
both an auth header (REST) and a session cookie (stream) reach the target
without any proxy change.

## Security rules

- **Never bake a token into the build** — use runtime (`localStorage`) or a
  gitignored `.env` only.
- On a **401/403 from the REST path**, do not silently fall back to sample data —
  surface an explicit "auth required / token rejected" state in the top bar
  (`fetchSnapshot` already classifies `auth` responses; the top bar reuses the
  `LIVE` / `SAMPLE DATA` badge area). The SSE stream cannot make this
  distinction (see above), so prefer a cookie scheme when you need the platform
  to reject the console cleanly.
- If you choose **OAuth2**, the redirect/callback route and token storage +
  refresh are a separate piece of work, not a header swap.

## Status

Not yet implemented. The scheme (cookie / Bearer / API key / OAuth2) is
intentionally left open — everything up to the provider point (REST) is
scheme-agnostic, and the stream is covered by a cookie with no code change. To
turn this guide into working auth: pick a scheme, decide how the **stream**
authenticates (cookie vs query-param vs fetch-based SSE), implement the provider
+ token source for the REST path, and add the 401/403 surface.
