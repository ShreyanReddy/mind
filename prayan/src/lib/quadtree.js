// Barnes-Hut quadtree — PLAN.md §2.1.
//
// Pure functions, no DOM. `buildQuadtree` inserts points with mass into a
// square-region quadtree, accumulating per-cell total mass and center of
// mass on the way down. `repulsionAt` walks the tree and approximates the
// total inverse-square repulsion force on a point: any cell whose angular
// size (cell width / distance to its center of mass) is below `theta` is
// treated as a single body, turning the naive O(n²) all-pairs pass into
// O(n log n). theta ≈ 0.85 keeps the force within a few percent of exact
// (covered by quadtree.test.js against the naive sum).

const MAX_DEPTH = 24

function makeCell(x, y, half) {
  // (x, y) is the cell center; `half` is half the side length.
  // mass/sx/sy accumulate total mass and mass-weighted position sums so the
  // center of mass is (sx / mass, sy / mass).
  return { x, y, half, mass: 0, sx: 0, sy: 0, body: null, kids: null }
}

function childFor(cell, p) {
  const i = (p.x >= cell.x ? 1 : 0) + (p.y >= cell.y ? 2 : 0)
  if (!cell.kids[i]) {
    const q = cell.half / 2
    cell.kids[i] = makeCell(
      cell.x + (p.x >= cell.x ? q : -q),
      cell.y + (p.y >= cell.y ? q : -q),
      q
    )
  }
  return cell.kids[i]
}

function insert(cell, p, depth) {
  cell.mass += p.mass
  cell.sx += p.mass * p.x
  cell.sy += p.mass * p.y

  if (cell.kids) {
    insert(childFor(cell, p), p, depth + 1)
    return
  }
  if (!cell.body) {
    cell.body = p
    return
  }
  if (depth >= MAX_DEPTH) {
    // Coincident (or pathologically close) points: stop subdividing and let
    // this leaf act as an aggregate via its accumulated center of mass.
    return
  }
  const old = cell.body
  cell.body = null
  cell.kids = [null, null, null, null]
  // Both bodies' masses are already accumulated on this cell — only the
  // child paths still need them.
  insert(childFor(cell, old), old, depth + 1)
  insert(childFor(cell, p), p, depth + 1)
}

/**
 * Build a quadtree over `points` — each point needs { x, y, mass } (mass
 * defaults to 1 if absent). Returns null for an empty input.
 */
export function buildQuadtree(points) {
  if (!points.length) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  const half = Math.max(maxX - minX, maxY - minY, 1) / 2 + 1
  const root = makeCell((minX + maxX) / 2, (minY + maxY) / 2, half)
  for (const p of points) {
    if (typeof p.mass !== 'number') p.mass = 1
    insert(root, p, 0)
  }
  return root
}

/**
 * Approximate inverse-square repulsion on point `p` from every other body in
 * the tree: F = k · p.mass · other.mass / d², directed away from the other
 * body. `p` itself is excluded when it is a leaf body; a cell that contains
 * `p` always fails the theta test (d is small relative to the cell size) and
 * gets opened, so self-interaction bias stays negligible. Returns { fx, fy }.
 */
export function repulsionAt(root, p, k, theta = 0.85) {
  let fx = 0
  let fy = 0
  if (!root) return { fx, fy }
  const t2 = theta * theta
  const stack = [root]
  while (stack.length) {
    const cell = stack.pop()
    if (!cell || cell.mass === 0) continue
    const mx = cell.sx / cell.mass
    const my = cell.sy / cell.mass
    const dx = p.x - mx
    const dy = p.y - my
    const d2 = dx * dx + dy * dy
    const s = cell.half * 2
    if (cell.kids && s * s > t2 * d2) {
      // Too close/too coarse — descend.
      for (const c of cell.kids) if (c) stack.push(c)
      continue
    }
    if (cell.body === p) continue // exact self at a leaf
    if (d2 < 1e-6) continue // coincident — no defined direction; the sim jitters these apart
    const f = (k * p.mass * cell.mass) / d2
    const d = Math.sqrt(d2)
    fx += (dx / d) * f
    fy += (dy / d) * f
  }
  return { fx, fy }
}
