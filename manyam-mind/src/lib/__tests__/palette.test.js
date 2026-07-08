import { describe, it, expect } from 'vitest'
import { hashHue, parseToHsl, hslCss, folderColor } from '../palette.js'

describe('hashHue', () => {
  it('is deterministic and in [0, 360)', () => {
    for (const name of ['Daily', 'Templates', 'Projects/Work', '', 'ü folders']) {
      const h = hashHue(name)
      expect(h).toBe(hashHue(name))
      expect(h).toBeGreaterThanOrEqual(0)
      expect(h).toBeLessThan(360)
      expect(Number.isInteger(h)).toBe(true)
    }
  })
})

describe('parseToHsl', () => {
  it('parses the brand token hex format', () => {
    const hsl = parseToHsl('#a882ff') // --glow-syn: a violet
    expect(hsl).not.toBeNull()
    expect(hsl.h).toBeGreaterThan(230)
    expect(hsl.h).toBeLessThan(290)
    expect(hsl.s).toBeGreaterThan(50)
    expect(hsl.l).toBeGreaterThan(50)
  })

  it('parses #rgb shorthand and rgb() strings', () => {
    expect(parseToHsl('#f00').h).toBeCloseTo(0, 5)
    expect(parseToHsl('rgb(255, 0, 0)').h).toBeCloseTo(0, 5)
  })

  it('returns null on garbage instead of throwing', () => {
    expect(parseToHsl('')).toBeNull()
    expect(parseToHsl('not-a-color')).toBeNull()
    expect(parseToHsl('#zz')).toBeNull()
  })
})

describe('folderColor', () => {
  it('keeps the base token color for folderless notes', () => {
    expect(folderColor('#a882ff', '')).toBe('#a882ff')
  })

  it('hue-rotates the base color per folder, preserving saturation/lightness', () => {
    const base = parseToHsl('#a882ff')
    const out = folderColor('#a882ff', 'Daily')
    const m = out.match(/^hsl\((\d+), (\d+)%, (\d+)%\)$/)
    expect(m).not.toBeNull()
    const h = Number(m[1])
    const s = Number(m[2])
    const l = Number(m[3])
    expect(h).toBe(Math.round((((base.h + hashHue('Daily')) % 360) + 360) % 360))
    expect(s).toBe(Math.round(base.s))
    expect(l).toBe(Math.round(base.l))
  })

  it('gives distinct folders distinct colors and is stable per folder', () => {
    const a = folderColor('#a882ff', 'Daily')
    const b = folderColor('#a882ff', 'Templates')
    expect(a).not.toBe(b)
    expect(folderColor('#a882ff', 'Daily')).toBe(a)
  })

  it('falls back to the base color when it cannot be parsed', () => {
    expect(folderColor('var(--oops)', 'Daily')).toBe('var(--oops)')
  })
})

describe('hslCss', () => {
  it('normalizes hue into [0, 360)', () => {
    expect(hslCss({ h: 380, s: 50, l: 50 })).toBe('hsl(20, 50%, 50%)')
    expect(hslCss({ h: -20, s: 50, l: 50 })).toBe('hsl(340, 50%, 50%)')
  })
})
