# Security Policy

## Supported versions

This project is pre-release (`0.0.0`) and under active development. Only the latest
`main` is supported; there are no maintained release branches yet.

| Version | Supported |
|---|---|
| `main` (latest) | ✅ |
| older commits | ❌ |

## Reporting a vulnerability

**Please do not open a public GitHub issue for security problems.**

Report privately using either of:

- GitHub's [private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
  ("Report a vulnerability" under the repository's **Security** tab), or
- Email **htjulia1@gmail.com** with the details.

Please include:

- a description of the issue and its impact,
- steps to reproduce (or a proof of concept),
- affected component/path and any relevant configuration.

We will acknowledge your report within a reasonable time, keep you updated on the
fix, and credit you if you wish once the issue is resolved.

## Scope & notes

This console is a **read-only, client-only** SPA — it ships no server. Keep these
in mind when assessing impact:

- **Credentials**: the console never bakes tokens into the build. REST requests
  attach a credential at a single choke point (`getJson` in `src/lib/api.ts`) at
  runtime or via a gitignored `.env`; the live SSE stream (`EventSource`, which
  cannot send headers) is best secured with a session cookie. See the
  [authentication guide](docs/authentication.md).
- **Data exposure**: the app only reads the Protean control-plane surface — the SSE
  stream (`/platform/traces/stream`) plus the REST endpoints (`/platform/traces`,
  `/platform/traces/metrics`, `/platform/modules`). Securing those endpoints is the
  responsibility of the consuming platform (typically Spring Security).
- Reports about third-party dependencies are welcome; where possible, prefer
  reporting upstream as well.
