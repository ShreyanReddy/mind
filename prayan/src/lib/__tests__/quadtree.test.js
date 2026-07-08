import { describe, it, expect } from 'vitest'
import { buildQuadtree, repulsionAt } from '../quadtree.js'

// deterministic PRNG so the accuracy stats are stable across runs
function mulberry32(seed) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function randomLayout(n, seed = 42) {
  const rnd = mulberry32(seed)
  const pts = []
  for (let i = 0; i < n; i++) {
    pts.push({ x: rnd() * 1000, y: rnd() * 800, mass: 1 + rnd() * 2 })
  }
  return pts
}

function naiveRepulsion(points, p, k) {
  let fx = 0
  let fy = 0
  for (const q of points) {
    if (q === p) continue
    const dx = p.x - q.x
    const dy = p.y - q.y
    const d2 = dx * dx + dy * dy
    if (d2 < 1e-6) continue
    const f = (k * p.mass * q.mass) / d2
    const d = Math.sqrt(d2)
    fx += (dx / d) * f
    fy += (dy / d) * f
  }
  return { fx, fy }
}

describe('Barnes-Hut quadtree', () => {
  it('handles empty and single-point inputs', () => {
    expect(buildQuadtree([])).toBeNull()
    expect(repulsionAt(null, { x: 0, y: 0, mass: 1 }, 100)).toEqual({ fx: 0, fy: 0 })
    const one = [{ x: 5, y: 5, mass: 1 }]
    const tree = buildQuadtree(one)
    expect(repulsionAt(tree, one[0], 100)).toEqual({ fx: 0, fy: 0 })
  })

  it('matches the exact two-body force when the tree is trivially small', () => {
    const pts = [
      { x: 0, y: 0, mass: 2 },
      { x: 10, y: 0, mass: 3 },
    ]
    const tree = buildQuadtree(pts)
    const { fx, fy } = repulsionAt(tree, pts[0], 100)
    // F = k·m1·m2/d² = 100·2·3/100 = 6, pointing away (−x)
    expect(fx).toBeCloseTo(-6, 6)
    expect(fy).toBeCloseTo(0, 6)
  })

  it('survives coincident points (max-depth aggregate leaves)', () => {
    const pts = [
      { x: 1, y: 1, mass: 1 },
      { x: 1, y: 1, mass: 1 },
      { x: 1, y: 1, mass: 1 },
      { x: 50, y: 50, mass: 1 },
    ]
    const tree = buildQuadtree(pts)
    const { fx, fy } = repulsionAt(tree, pts[3], 100)
    expect(Number.isFinite(fx)).toBe(true)
    expect(Number.isFinite(fy)).toBe(true)
    // three unit masses at (1,1) push (50,50) up-right
    expect(fx).toBeGreaterThan(0)
    expect(fy).toBeGreaterThan(0)
  })

  it('approximates the naive O(n²) force within tolerance at theta 0.85 (summary stats)', () => {
    const pts = randomLayout(400)
    const tree = buildQuadtree(pts)
    const K = 2600

    let sumRelErr = 0
    let sumCos = 0
    for (const p of pts) {
      const bh = repulsionAt(tree, p, K, 0.85)
      const ex = naiveRepulsion(pts, p, K)
      const bhMag = Math.hypot(bh.fx, bh.fy)
      const exMag = Math.hypot(ex.fx, ex.fy)
      sumRelErr += Math.abs(bhMag - exMag) / (exMag || 1)
      sumCos += (bh.fx * ex.fx + bh.fy * ex.fy) / ((bhMag || 1) * (exMag || 1))
    }
    const meanRelErr = sumRelErr / pts.length
    const meanCos = sumCos / pts.length

    // magnitudes agree on average within 10%, directions nearly parallel
    expect(meanRelErr).toBeLessThan(0.1)
    expect(meanCos).toBeGreaterThan(0.97)
  })

  it('perf budget: one full force pass over 5,000 nodes stays under 100ms', () => {
    const pts = randomLayout(5000, 7)

    // warm-up pass so JIT compilation doesn't bill the measured run
    let tree = buildQuadtree(pts)
    for (const p of pts) repulsionAt(tree, p, 2600, 0.85)

    const t0 = performance.now()
    tree = buildQuadtree(pts)
    for (const p of pts) repulsionAt(tree, p, 2600, 0.85)
    const ms = performance.now() - t0

    expect(ms).toBeLessThan(100)
  }, 20000)
})
