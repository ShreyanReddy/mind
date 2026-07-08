// Force-simulation physics — PLAN.md §2.1.
//
// Pure module shared by the Web Worker (src/workers/graphSim.js) and the
// main-thread fallback in GraphView (jsdom / browsers without Worker), so
// tests can drive the exact code that ships. One fixed-timestep step is:
// Barnes-Hut repulsion (quadtree.js) + springs along edges + gentle
// centering + velocity damping. The feel matches the original O(n²) sim:
// spring rest length shrinks with edge weight (strong synapses pull
// tighter), damping 0.85.

import { buildQuadtree, repulsionAt } from './quadtree.js'

export const DAMPING = 0.85
export const REPULSION = 2600
export const THETA = 0.85
export const CENTER_PULL = 0.0012
export const SPRING = 0.004
/** Average v² per node below which the layout counts as settled. */
export const SETTLED_ENERGY = 0.02

export function createSim() {
  return { nodes: [], byId: new Map(), springs: [] }
}

/**
 * Reconcile the sim with a topology snapshot. Existing nodes keep their
 * position/velocity; new nodes spawn at their provided seed { x, y } (last
 * known position, e.g. during time-lapse scrubbing) or randomly near the
 * view center; nodes absent from the snapshot are dropped.
 * nodes: [{ id, mass, x?, y? }], edges: [{ a, b, w }].
 */
export function syncSim(sim, nodes, edges, view = { width: 800, height: 600 }) {
  const cx = view.width / 2
  const cy = view.height / 2
  const next = []
  const nextById = new Map()
  for (const n of nodes) {
    let node = sim.byId.get(n.id)
    if (node) {
      node.mass = n.mass || 1
    } else {
      node = {
        id: n.id,
        mass: n.mass || 1,
        x: typeof n.x === 'number' ? n.x : cx + (Math.random() - 0.5) * 220,
        y: typeof n.y === 'number' ? n.y : cy + (Math.random() - 0.5) * 220,
        vx: 0,
        vy: 0,
        pinned: false,
      }
    }
    next.push(node)
    nextById.set(node.id, node)
  }
  sim.nodes = next
  sim.byId = nextById
  sim.springs = []
  for (const e of edges) {
    const a = nextById.get(e.a)
    const b = nextById.get(e.b)
    if (a && b) sim.springs.push({ a, b, w: e.w || 1 })
  }
}

/** Pin a node under the pointer while dragging — it moves only where told. */
export function pinNode(sim, id, x, y) {
  const n = sim.byId.get(id)
  if (!n) return
  n.pinned = true
  n.x = x
  n.y = y
  n.vx = 0
  n.vy = 0
}

export function unpinNode(sim, id) {
  const n = sim.byId.get(id)
  if (n) n.pinned = false
}

/**
 * One fixed-timestep step. Returns the layout energy (average v² per node)
 * after integration — the worker uses it to throttle when the layout has
 * settled, tests use it to assert convergence.
 */
export function stepSim(sim, view = { width: 800, height: 600 }) {
  const nodes = sim.nodes
  if (!nodes.length) return 0
  const cx = view.width / 2
  const cy = view.height / 2

  // Barnes-Hut repulsion + centering. Dividing the pair force k·mᵃ·mᵇ/d² by
  // the node's own mass keeps unit-mass behavior identical to the original
  // sim while letting heavier neurons claim proportionally more space.
  const tree = buildQuadtree(nodes)
  for (const n of nodes) {
    const { fx, fy } = repulsionAt(tree, n, REPULSION, THETA)
    if (fx === 0 && fy === 0 && nodes.length > 1) {
      // Coincident with another body (no defined direction) — jitter apart.
      n.vx += (Math.random() - 0.5) * 0.5
      n.vy += (Math.random() - 0.5) * 0.5
    } else {
      n.vx += fx / n.mass
      n.vy += fy / n.mass
    }
    n.vx += (cx - n.x) * CENTER_PULL
    n.vy += (cy - n.y) * CENTER_PULL
  }

  // Springs — rest length shrinks with weight: strong synapses pull tighter.
  for (const s of sim.springs) {
    const dx = s.b.x - s.a.x
    const dy = s.b.y - s.a.y
    const d = Math.sqrt(dx * dx + dy * dy) || 1
    const rest = 90 - Math.min(30, s.w * 6)
    const f = (d - rest) * SPRING * Math.min(3, s.w)
    s.a.vx += (dx / d) * f
    s.a.vy += (dy / d) * f
    s.b.vx -= (dx / d) * f
    s.b.vy -= (dy / d) * f
  }

  let energy = 0
  for (const n of nodes) {
    if (n.pinned) {
      n.vx = 0
      n.vy = 0
      continue
    }
    n.vx *= DAMPING
    n.vy *= DAMPING
    n.x += n.vx
    n.y += n.vy
    energy += n.vx * n.vx + n.vy * n.vy
  }
  return energy / nodes.length
}

/**
 * Step until the layout settles or `maxSteps` elapse. Used by the
 * reduced-motion static layout (PLAN.md §2.4) and by tests. Returns the
 * final energy.
 */
export function runToRest(sim, view, maxSteps = 300, settled = SETTLED_ENERGY) {
  let energy = Infinity
  for (let i = 0; i < maxSteps; i++) {
    energy = stepSim(sim, view)
    if (energy < settled) break
  }
  return energy
}
