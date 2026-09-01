import { describe, expect, it } from 'vitest'
import { shouldLoadOlder } from '@/components/trace-table'

/**
 * When the trace table is allowed to pull another page of history.
 *
 * This exists because the rule was wrong in a way that cost the whole store: the
 * proximity test ran against the *filtered* row count, so a filter matching almost
 * nothing satisfied it forever. Pressing "Errors only" on a 47,320-row store issued
 * 189 IndexedDB page reads in three seconds and blinked the control between
 * "Load older" and "loading…" until it had paged everything into memory.
 *
 * The rule is asserted directly rather than through the DOM. The table body is
 * virtualized, and jsdom reports zero height for the scroll box — so the virtualizer
 * renders no rows, `itemCount` is 0, and every DOM-level assertion about this effect
 * passes for the wrong reason. (Measured: that is exactly why counting `tbody tr`
 * compared 0 to 0 elsewhere in this suite.)
 */

/** A list that overflows its box, scrolled to the bottom — the case that should load. */
const AT_END = {
  hasMore: true,
  loadingOlder: false,
  itemCount: 30,
  lastIndex: 199,
  rowCount: 200,
  totalSize: 200 * 44,
  viewportHeight: 520,
}

describe('scrolled to the end of a full list', () => {
  it('pulls the next page', () => {
    expect(shouldLoadOlder(AT_END)).toBe(true)
  })

  it('pulls it a little before the very last row', () => {
    // The window exists so the next page arrives before the user hits the floor.
    expect(shouldLoadOlder({ ...AT_END, lastIndex: 185 })).toBe(true)
    expect(shouldLoadOlder({ ...AT_END, lastIndex: 184 })).toBe(false)
  })

  it('stops when there is nothing older', () => {
    expect(shouldLoadOlder({ ...AT_END, hasMore: false })).toBe(false)
  })

  it('does not stack requests', () => {
    expect(shouldLoadOlder({ ...AT_END, loadingOlder: true })).toBe(false)
  })
})

describe('a filter that leaves too little to scroll', () => {
  it('🔴 does not page the store looking for matches — nothing matched', () => {
    // The defect, exactly: `lastIndex` 0 >= `rowCount - 15` (-15) is true, so without
    // the overflow gate this returned true on an empty result and kept returning it.
    expect(
      shouldLoadOlder({
        ...AT_END,
        itemCount: 0,
        lastIndex: 0,
        rowCount: 0,
        totalSize: 0,
      }),
    ).toBe(false)
  })

  it('🔴 nor when a couple of rows matched', () => {
    // The shape the user hit: "Errors only" found two rows out of two hundred.
    expect(
      shouldLoadOlder({
        ...AT_END,
        itemCount: 2,
        lastIndex: 1,
        rowCount: 2,
        totalSize: 2 * 44,
      }),
    ).toBe(false)
  })

  it('nor when the matches nearly fill the box but cannot scroll', () => {
    // The boundary: a list exactly as tall as its viewport has no scroll to reach the
    // end of, so "the last row is in view" carries no intent.
    expect(shouldLoadOlder({ ...AT_END, itemCount: 11, lastIndex: 10, rowCount: 11, totalSize: 520 })).toBe(false)
    expect(shouldLoadOlder({ ...AT_END, itemCount: 12, lastIndex: 11, rowCount: 12, totalSize: 521 })).toBe(true)
  })
})

describe('a viewport that has not been measured yet', () => {
  it('does not load on the first render, before layout', () => {
    // jsdom reports 0, and so does a real browser for one frame after mount. Treating
    // that as "the list overflows" would fire a load nobody asked for on every mount.
    expect(shouldLoadOlder({ ...AT_END, viewportHeight: 0, totalSize: 0, itemCount: 0 })).toBe(false)
  })

  it('🔴 nor when the list measures tall but nothing is rendered yet', () => {
    // The case the `itemCount` guard alone covers, and the one my first pass missed:
    // before layout the box reports 0 height while the virtual list already has a
    // size, so the overflow test passes. With few rows the proximity test passes too
    // (`lastIndex` 0 >= `rowCount - 15`), and a page would load with nothing on screen
    // to have scrolled. Measured: removing the guard makes this the only failure.
    expect(
      shouldLoadOlder({
        ...AT_END,
        itemCount: 0,
        lastIndex: 0,
        rowCount: 12,
        totalSize: 12 * 44,
        viewportHeight: 0,
      }),
    ).toBe(false)
  })

  it('and not when the box is huge enough to hold everything', () => {
    // A tall screen showing all 200 rows at once: the button is there to be pressed,
    // but nothing should load on its own.
    expect(shouldLoadOlder({ ...AT_END, viewportHeight: 20_000 })).toBe(false)
  })
})
