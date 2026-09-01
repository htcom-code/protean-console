import { afterEach, describe, expect, it, vi } from 'vitest'
import { platformOrigin } from '@/hooks/use-console-data'

/**
 * What the header claims about which platform this console is connected to.
 *
 * The claim has to hold in a production bundle, where the dev proxy does not
 * exist: requests go to the origin serving the console whatever the build-time
 * variable said, so naming that variable there would print an address no request
 * is ever sent to. That is the case worth pinning — it cannot be caught by looking
 * at a dev server.
 */
const setEnv = (env: Record<string, unknown>) => {
  vi.stubGlobal('import', undefined) // no-op; import.meta is stubbed per-key below
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v as string)
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('platformOrigin', () => {
  it('names the platform behind the dev proxy, not the dev server', () => {
    setEnv({ DEV: true, VITE_PROTEAN_TARGET: 'http://localhost:8090' })
    expect(platformOrigin()).toBe('http://localhost:8090')
  })

  it('falls back to the serving origin when no proxy target is configured', () => {
    setEnv({ DEV: true, VITE_PROTEAN_TARGET: '' })
    expect(platformOrigin()).toBe(window.location.origin)
  })

  it('ignores the build-time target in a production bundle', () => {
    // The proxy is a dev-server feature. A production build sends every request to
    // its own origin, so trusting the variable here would name the wrong server.
    setEnv({ DEV: false, VITE_PROTEAN_TARGET: 'http://built-with-this:8090' })
    expect(platformOrigin()).toBe(window.location.origin)
  })

  it('does not double the slash when the target carries a trailing one', () => {
    setEnv({ DEV: true, VITE_PROTEAN_TARGET: 'http://localhost:8090/' })
    expect(platformOrigin()).toBe('http://localhost:8090')
  })
})
