// Graph simulation Web Worker — PLAN.md §2.1.
//
// Owns the force-simulation state so 5k nodes never touch the main thread's
// frame budget. The physics itself lives in src/lib/graphPhysics.js (pure,
// unit-tested, shared with GraphView's no-Worker fallback). Protocol:
//
//   in:  { type: 'sync', nodes: [{ id, mass, x?, y? }], edges: [{ a, b, w }], view? }
//        { type: 'view', view: { width, height } }
//        { type: 'pin', id, x, y }   — drag: node follows the pointer
//        { type: 'unpin', id }
//   out: { type: 'topology', v, ids }              — node order for buffers
//        { type: 'positions', v, buf: Float32Array } — [x0, y0, x1, y1, …],
//        posted as a transferable at ~60Hz while the layout is hot, then
//        throttled to a low frequency once its energy settles.

import { createSim, syncSim, stepSim, pinNode, unpinNode, SETTLED_ENERGY } from '../lib/graphPhysics.js'

const HOT_MS = 16
const COLD_MS = 250
const SETTLE_FRAMES = 45 // this many consecutive calm steps before throttling

const sim = createSim()
let view = { width: 800, height: 600 }
let ids = []
let version = 0
let calmFrames = 0
let timer = null

function postPositions() {
  const buf = new Float32Array(ids.length * 2)
  for (let i = 0; i < ids.length; i++) {
    const n = sim.byId.get(ids[i])
    buf[i * 2] = n ? n.x : 0
    buf[i * 2 + 1] = n ? n.y : 0
  }
  self.postMessage({ type: 'positions', v: version, buf }, [buf.buffer])
}

function tick() {
  const energy = stepSim(sim, view)
  calmFrames = energy < SETTLED_ENERGY ? calmFrames + 1 : 0
  postPositions()
  timer = setTimeout(tick, calmFrames >= SETTLE_FRAMES ? COLD_MS : HOT_MS)
}

function wake() {
  calmFrames = 0
  if (timer !== null) clearTimeout(timer)
  timer = setTimeout(tick, 0)
}

self.onmessage = (e) => {
  const m = e.data
  if (m.type === 'sync') {
    if (m.view) view = m.view
    syncSim(sim, m.nodes, m.edges, view)
    ids = sim.nodes.map((n) => n.id)
    version++
    self.postMessage({ type: 'topology', v: version, ids })
    wake()
  } else if (m.type === 'view') {
    view = m.view
  } else if (m.type === 'pin') {
    pinNode(sim, m.id, m.x, m.y)
    wake()
  } else if (m.type === 'unpin') {
    unpinNode(sim, m.id)
    wake()
  }
}
