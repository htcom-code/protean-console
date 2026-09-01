import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS,
  EVICTION_FACTORS,
  RETENTION_MIN,
  evictionCount,
  loadSettings,
  saveSettings,
  validate,
  type Settings,
} from '@/lib/settings'

/**
 * Settings are the one place where a wrong value is not merely wrong on screen: the
 * retention limit and the eviction factor decide what gets deleted from the user's
 * history. So the rules are checked at the boundary the pruner trusts — a validator
 * that lets a string through, or a stored value that skips validation on the way
 * out, prunes with `NaN` and does it silently.
 */

const KEYS = ['pc:retention', 'pc:evictionFactor', 'pc:pageSize', 'pc:sampleDelayMs']

beforeEach(() => {
  for (const k of KEYS) window.localStorage.removeItem(k)
})

describe('what a setting is allowed to be', () => {
  it('holds the retention floor the user set', () => {
    expect(RETENTION_MIN).toBe(50_000)
    expect(validate('retention', 50_000)).toBeNull()
    expect(validate('retention', 49_999)).toContain('50,000')
    expect(validate('retention', 1_000_000)).toBeNull()
  })

  it('refuses what looks like a number but is not one', () => {
    // The field arrives from a text input, so these are the shapes it really takes.
    for (const bad of ['', ' ', 'abc', '50_000', '5e4x', null, undefined, NaN, Infinity, '50000.5']) {
      expect(validate('retention', bad), String(bad)).not.toBeNull()
    }
    // A numeric string is fine — that is what the input gives us.
    expect(validate('retention', '60000')).toBeNull()
  })

  it('accepts only the four eviction factors, and nothing between them', () => {
    for (const f of EVICTION_FACTORS) expect(validate('evictionFactor', f)).toBeNull()
    for (const bad of [0, 3, 5, 16, -1, 'lots']) expect(validate('evictionFactor', bad)).not.toBeNull()
  })

  it('bounds page size and sample delay on both sides', () => {
    expect(validate('pageSize', 0)).not.toBeNull()
    expect(validate('pageSize', 1)).toBeNull()
    expect(validate('pageSize', 2_000)).toBeNull()
    expect(validate('pageSize', 2_001)).not.toBeNull()

    expect(validate('sampleDelayMs', 499)).not.toBeNull()
    expect(validate('sampleDelayMs', 500)).toBeNull()
    expect(validate('sampleDelayMs', 30_000)).toBeNull()
    expect(validate('sampleDelayMs', 30_001)).not.toBeNull()
  })
})

describe('what comes back out of storage', () => {
  it('round-trips a saved set', () => {
    const mine: Settings = { retention: 120_000, evictionFactor: 4, pageSize: 50, sampleDelayMs: 1_000 }
    saveSettings(mine)
    expect(loadSettings()).toEqual(mine)
  })

  it('defaults when nothing was ever saved', () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS)
  })

  it('validates on the way out, not only on the way in', () => {
    // 🔴 A hand-edited or stale entry reaches the pruner otherwise: `readStored`
    // parses JSON and stops there, so a string where a number is expected would
    // make `evictionCount` return NaN and `pruneOldest` delete nothing — retention
    // silently off with no sign on screen.
    window.localStorage.setItem('pc:retention', '"lots"')
    window.localStorage.setItem('pc:evictionFactor', '3')
    window.localStorage.setItem('pc:pageSize', '0')

    const loaded = loadSettings()
    expect(loaded.retention).toBe(DEFAULT_SETTINGS.retention)
    expect(loaded.evictionFactor).toBe(DEFAULT_SETTINGS.evictionFactor)
    expect(loaded.pageSize).toBe(DEFAULT_SETTINGS.pageSize)
    expect(Number.isFinite(loaded.retention)).toBe(true)
  })

  it('keeps the fields that are still usable when one is corrupt', () => {
    saveSettings({ retention: 90_000, evictionFactor: 8, pageSize: 20, sampleDelayMs: 800 })
    window.localStorage.setItem('pc:pageSize', 'null')

    const loaded = loadSettings()
    expect(loaded.pageSize).toBe(DEFAULT_SETTINGS.pageSize)
    expect(loaded.retention).toBe(90_000)
    expect(loaded.evictionFactor).toBe(8)
    expect(loaded.sampleDelayMs).toBe(800)
  })

  it('survives a below-floor retention left over from an earlier build', () => {
    // The floor is new. A browser that used this console before it existed can hold
    // a smaller number, and honouring it would quietly shrink the user's history.
    window.localStorage.setItem('pc:retention', '5000')
    expect(loadSettings().retention).toBe(RETENTION_MIN)
  })
})

describe('how many rows an over-limit batch evicts', () => {
  const s = (over: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, retention: 100, ...over })

  it('evicts nothing while there is room', () => {
    expect(evictionCount(99, 10, s())).toBe(0)
    expect(evictionCount(100, 10, s())).toBe(0)
  })

  it('at factor 1, evicts exactly the overflow', () => {
    expect(evictionCount(101, 1, s())).toBe(1)
    expect(evictionCount(110, 10, s())).toBe(10)
  })

  it('at a higher factor, evicts a multiple of what arrived so the next batches fit', () => {
    expect(evictionCount(110, 10, s({ evictionFactor: 2 }))).toBe(20)
    expect(evictionCount(110, 10, s({ evictionFactor: 4 }))).toBe(40)
    expect(evictionCount(110, 10, s({ evictionFactor: 8 }))).toBe(80)
  })

  it('still clears the whole overflow when the arrival is small', () => {
    // A store far over the limit — a limit lowered in the dialog, say — has to come
    // down to it even though only one row arrived.
    expect(evictionCount(500, 1, s())).toBe(400)
    expect(evictionCount(500, 1, s({ evictionFactor: 8 }))).toBe(400)
  })

  it('never asks to delete more rows than exist', () => {
    expect(evictionCount(120, 100, s({ evictionFactor: 8 }))).toBe(120)
  })
})
