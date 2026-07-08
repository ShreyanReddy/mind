import { describe, it, expect } from 'vitest'
import {
  createSim,
  syncSim,
  stepSim,
  runToRest,
  pinNode,
  unpinNode,
  SETTLED_ENERGY,
} from '../graphPhysics.js'

const VIEW = { width: 800, height: 600 }

/** Deterministic cramped starting positions so convergence stats are stable. */
function cram(sim) {
  sim.nodes.forEach((n, i) => {
    n.x = VIEW.width / 2 + (i % 7) * 4
    n.y = VIEW.height / 2 + Math.floor(i / 7) * 4
    n.vx = 0
    n.vy = 0
  })
}

function clusteredGraph() {
  // 3 clusters of 5, fully linked within a cluster, no cross-links
  const nodes = []
  const edges = []
  for (let c = 0; c < 3; c++) {
    for (let i = 0; i < 5; i++) nodes.push({ id: `c${c}n${i}`, mass: 1 })
    for (let i = 0; i < 5; i++) {
      for (let j = i + 1; j < 5; j++) edges.push({ a: `c${c}n${i}`, b: `c${c}n${j}`, w: 1 })
    }
  }
  return { nodes, edges }
}

describe('graphPhysics step', () => {
  it('energy decreases from its early peak and the layout settles', () => {
    const { nodes, edges } = clusteredGraph()
    const sim = createSim()
    syncSim(sim, nodes, edges, VIEW)
    cram(sim)

    const energies = []
    for (let i = 0; i < 400; i++) energies.push(stepSim(sim, VIEW))

    const peak = Math.max(...energies.slice(0, 30))
    const final = energies[energies.length - 1]

    expect(peak).toBeGreaterThan(final)
    expect(final).toBeLessThan(Math.max(0.05, peak * 0.05))
    for (const n of sim.nodes) {
      expect(Number.isFinite(n.x)).toBe(true)
      expect(Number.isFinite(n.y)).toBe(true)
    }
  })

  it('produces a stable layout: linked nodes end up closer than the global average', () => {
    const { nodes, edges } = clusteredGraph()
    const sim = createSim()
    syncSim(sim, nodes, edges, VIEW)
    cram(sim)
    runToRest(sim, VIEW, 600)

    const pos = new Map(sim.nodes.map((n) => [n.id, n]))
    const dist = (a, b) => Math.hypot(pos.get(a).x - pos.get(b).x, pos.get(a).y - pos.get(b).y)

    let linked = 0
    for (const e of edges) linked += dist(e.a, e.b)
    linked /= edges.length

    let all = 0
    let pairs = 0
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        all += dist(nodes[i].id, nodes[j].id)
        pairs++
      }
    }
    all /= pairs

    expect(linked).toBeLessThan(all)
  })

  it('runToRest converges below the settled-energy threshold', () => {
    const { nodes, edges } = clusteredGraph()
    const sim = createSim()
    syncSim(sim, nodes, edges, VIEW)
    cram(sim)
    const energy = runToRest(sim, VIEW, 1000)
    expect(energy).toBeLessThan(SETTLED_ENERGY)
  })

  it('a pinned (dragged) node stays exactly where it was pinned', () => {
    const { nodes, edges } = clusteredGraph()
    const sim = createSim()
    syncSim(sim, nodes, edges, VIEW)
    cram(sim)
    pinNode(sim, 'c0n0', 123, 456)
    for (let i = 0; i < 100; i++) stepSim(sim, VIEW)
    const n = sim.byId.get('c0n0')
    expect(n.x).toBe(123)
    expect(n.y).toBe(456)
    unpinNode(sim, 'c0n0')
    for (let i = 0; i < 20; i++) stepSim(sim, VIEW)
    expect(n.x === 123 && n.y === 456).toBe(false) // free again
  })

  it('syncSim keeps existing positions, seeds provided ones, and drops removed nodes', () => {
    const sim = createSim()
    syncSim(sim, [{ id: 'a' }, { id: 'b' }], [], VIEW)
    const ax = sim.byId.get('a').x
    const ay = sim.byId.get('a').y

    // re-sync: keep a, drop b, add c with a seed position
    syncSim(sim, [{ id: 'a' }, { id: 'c', x: 50, y: 60 }], [{ a: 'a', b: 'c', w: 2 }], VIEW)
    expect(sim.byId.get('a').x).toBe(ax)
    expect(sim.byId.get('a').y).toBe(ay)
    expect(sim.byId.has('b')).toBe(false)
    expect(sim.byId.get('c').x).toBe(50)
    expect(sim.byId.get('c').y).toBe(60)
    expect(sim.springs).toHaveLength(1)
  })
})
