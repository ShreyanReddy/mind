// Cluster palette — PLAN.md §2.3 cluster coloring by folder.
//
// No hardcoded colors: the base color is always a CSS custom property value
// read at runtime (GraphView passes the --glow-syn / --glow-mind tokens).
// A folder name hashes to a stable hue rotation applied to that base color
// in HSL space, so every folder gets a distinct-but-on-brand color that
// automatically follows a rebrand of the tokens.

/** Stable hash of a folder name to a hue offset in [0, 360). */
export function hashHue(name = '') {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0
  return ((h % 360) + 360) % 360
}

/** Parse #rgb / #rrggbb / rgb(a) CSS color to { h, s, l } (deg, %, %). Null if unparseable. */
export function parseToHsl(color) {
  const c = (color || '').trim()
  let r, g, b
  if (c.startsWith('#')) {
    let hex = c.slice(1)
    if (hex.length === 3)
      hex = hex
        .split('')
        .map((ch) => ch + ch)
        .join('')
    if (hex.length < 6) return null
    r = parseInt(hex.slice(0, 2), 16) / 255
    g = parseInt(hex.slice(2, 4), 16) / 255
    b = parseInt(hex.slice(4, 6), 16) / 255
  } else {
    const m = c.match(/rgba?\(([^)]+)\)/)
    if (!m) return null
    const parts = m[1].split(',').map((x) => parseFloat(x))
    if (parts.length < 3 || parts.some((x) => Number.isNaN(x))) return null
    r = parts[0] / 255
    g = parts[1] / 255
    b = parts[2] / 255
  }
  if ([r, g, b].some((x) => Number.isNaN(x))) return null

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  let h = 0
  let s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60
    else if (max === g) h = ((b - r) / d + 2) * 60
    else h = ((r - g) / d + 4) * 60
  }
  return { h, s: s * 100, l: l * 100 }
}

export function hslCss({ h, s, l }) {
  return `hsl(${Math.round(((h % 360) + 360) % 360)}, ${Math.round(s)}%, ${Math.round(l)}%)`
}

/**
 * The cluster color for a folder: the base token color hue-rotated by the
 * folder's hash. Folderless notes keep the base color untouched.
 */
export function folderColor(baseColor, folder) {
  if (!folder) return baseColor
  const hsl = parseToHsl(baseColor)
  if (!hsl) return baseColor
  return hslCss({ ...hsl, h: hsl.h + hashHue(folder) })
}
