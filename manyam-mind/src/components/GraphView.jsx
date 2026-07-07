// GraphView — the living network. Custom force simulation on canvas:
// repulsion between neurons, springs along synapses, gentle centering.
// Node size/brightness = synaptic strength (edits + connectivity).
// Recently-edited nodes pulse; new links fire a traveling spark.

import { useEffect, useRef } from 'react'
import { vault } from '../lib/store.js'
import { buildGraph } from '../lib/links.js'

const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim()

export default function GraphView({ onOpenNote }) {
  const canvasRef = useRef(null)
  const stateRef = useRef({ sim: new Map(), edges: [], sparks: [], drag: null, pan: { x: 0, y: 0 }, zoom: 1 })

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const S = stateRef.current
    let raf, alive = true
    let prevEdgeKeys = new Set()

    const colors = {
      syn: css('--glow-syn') || '#58e6d9',
      mind: css('--glow-mind') || '#8f7bff',
      dim: css('--paper-dim') || '#9aa5c0',
    }

    function sync() {
      const { notes, activity } = vault.get()
      const g = buildGraph(notes, activity)
      const cx = canvas.width / 2, cy = canvas.height / 2

      const seen = new Set()
      for (const n of g.nodes) {
        seen.add(n.id)
        const existing = S.sim.get(n.id)
        if (existing) Object.assign(existing, n)
        else
          S.sim.set(n.id, {
            ...n,
            x: cx + (Math.random() - 0.5) * 220,
            y: cy + (Math.random() - 0.5) * 220,
            vx: 0, vy: 0,
          })
      }
      for (const id of [...S.sim.keys()]) if (!seen.has(id)) S.sim.delete(id)

      // new synapse? fire a spark along it
      const keys = new Set(g.edges.map((e) => e.a + '~' + e.b))
      for (const e of g.edges) {
        const k = e.a + '~' + e.b
        if (!prevEdgeKeys.has(k) && prevEdgeKeys.size) S.sparks.push({ a: e.a, b: e.b, t: 0 })
      }
      prevEdgeKeys = keys
      S.edges = g.edges
    }

    const unsub = vault.subscribe(sync)
    sync()

    function resize() {
      const r = canvas.parentElement.getBoundingClientRect()
      canvas.width = r.width * devicePixelRatio
      canvas.height = r.height * devicePixelRatio
      canvas.style.width = r.width + 'px'
      canvas.style.height = r.height + 'px'
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas.parentElement)

    const radius = (n) => 4 + Math.min(14, Math.sqrt(n.edits + n.degree * 3) * 2)

    function step() {
      const nodes = [...S.sim.values()]
      const cx = canvas.width / 2, cy = canvas.height / 2

      // repulsion (O(n²) is fine below ~600 notes; PLAN.md swaps in Barnes-Hut)
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i]
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j]
          let dx = a.x - b.x, dy = a.y - b.y
          let d2 = dx * dx + dy * dy || 1
          if (d2 > 90000) continue
          const f = 2600 / d2
          const d = Math.sqrt(d2)
          dx /= d; dy /= d
          a.vx += dx * f; a.vy += dy * f
          b.vx -= dx * f; b.vy -= dy * f
        }
        // gravity toward center
        a.vx += (cx - a.x) * 0.0012
        a.vy += (cy - a.y) * 0.0012
      }
      // springs
      for (const e of S.edges) {
        const a = S.sim.get(e.a), b = S.sim.get(e.b)
        if (!a || !b) continue
        const dx = b.x - a.x, dy = b.y - a.y
        const d = Math.sqrt(dx * dx + dy * dy) || 1
        const rest = 90 - Math.min(30, e.w * 6) // stronger synapses pull tighter
        const f = (d - rest) * 0.004 * Math.min(3, e.w)
        a.vx += (dx / d) * f; a.vy += (dy / d) * f
        b.vx -= (dx / d) * f; b.vy -= (dy / d) * f
      }
      for (const n of nodes) {
        if (S.drag?.id === n.id) { n.vx = n.vy = 0; continue }
        n.vx *= 0.85; n.vy *= 0.85
        n.x += n.vx; n.y += n.vy
      }
    }

    function draw(t) {
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.setTransform(S.zoom, 0, 0, S.zoom, S.pan.x, S.pan.y)

      // synapses
      for (const e of S.edges) {
        const a = S.sim.get(e.a), b = S.sim.get(e.b)
        if (!a || !b) continue
        ctx.strokeStyle = colors.syn
        ctx.globalAlpha = Math.min(0.65, 0.14 + e.w * 0.12)
        ctx.lineWidth = Math.min(4, e.w) * devicePixelRatio * 0.7
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke()
      }
      ctx.globalAlpha = 1

      // sparks travel along new synapses
      S.sparks = S.sparks.filter((s) => s.t < 1)
      for (const s of S.sparks) {
        const a = S.sim.get(s.a), b = S.sim.get(s.b)
        if (!a || !b) { s.t = 1; continue }
        s.t += 0.02
        const x = a.x + (b.x - a.x) * s.t, y = a.y + (b.y - a.y) * s.t
        ctx.fillStyle = colors.syn
        ctx.shadowColor = colors.syn; ctx.shadowBlur = 18
        ctx.beginPath(); ctx.arc(x, y, 3.5 * devicePixelRatio, 0, 7); ctx.fill()
        ctx.shadowBlur = 0
      }

      // neurons
      for (const n of S.sim.values()) {
        const r = radius(n) * devicePixelRatio
        const hub = n.degree >= 3
        const pulse = n.recent ? 1 + 0.25 * Math.sin(t / 160) : 1
        ctx.fillStyle = hub ? colors.mind : colors.syn
        ctx.shadowColor = ctx.fillStyle
        ctx.shadowBlur = (n.recent ? 26 : 8 + n.degree * 2) * pulse
        ctx.beginPath(); ctx.arc(n.x, n.y, r * pulse, 0, 7); ctx.fill()
        ctx.shadowBlur = 0

        if (r > 6 * devicePixelRatio || S.zoom > 1.3) {
          ctx.fillStyle = colors.dim
          ctx.font = `${11 * devicePixelRatio}px Inter, sans-serif`
          ctx.textAlign = 'center'
          ctx.fillText(n.title.slice(0, 24), n.x, n.y + r + 14 * devicePixelRatio)
        }
      }
    }

    function loop(t) {
      if (!alive) return
      step(); draw(t)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    // interaction: drag neurons, pan space, wheel zoom, click to open
    const toWorld = (e) => {
      const r = canvas.getBoundingClientRect()
      return {
        x: ((e.clientX - r.left) * devicePixelRatio - S.pan.x) / S.zoom,
        y: ((e.clientY - r.top) * devicePixelRatio - S.pan.y) / S.zoom,
      }
    }
    const hit = (p) => {
      for (const n of S.sim.values()) {
        const r = radius(n) * devicePixelRatio + 6
        if ((n.x - p.x) ** 2 + (n.y - p.y) ** 2 < r * r) return n
      }
      return null
    }

    let moved = false
    const down = (e) => {
      const p = toWorld(e)
      const n = hit(p)
      moved = false
      S.drag = n ? { id: n.id } : { pan: true, sx: e.clientX, sy: e.clientY, px: S.pan.x, py: S.pan.y }
    }
    const move = (e) => {
      if (!S.drag) return
      moved = true
      if (S.drag.id) {
        const p = toWorld(e)
        const n = S.sim.get(S.drag.id)
        if (n) { n.x = p.x; n.y = p.y }
      } else {
        S.pan.x = S.drag.px + (e.clientX - S.drag.sx) * devicePixelRatio
        S.pan.y = S.drag.py + (e.clientY - S.drag.sy) * devicePixelRatio
      }
    }
    const up = () => {
      if (S.drag?.id && !moved) onOpenNote?.(S.drag.id)
      S.drag = null
    }
    const wheel = (e) => {
      e.preventDefault()
      const z = Math.min(3, Math.max(0.35, S.zoom * (e.deltaY < 0 ? 1.1 : 0.9)))
      S.zoom = z
    }
    canvas.addEventListener('mousedown', down)
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    canvas.addEventListener('wheel', wheel, { passive: false })

    return () => {
      alive = false
      cancelAnimationFrame(raf)
      unsub(); ro.disconnect()
      canvas.removeEventListener('mousedown', down)
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      canvas.removeEventListener('wheel', wheel)
    }
  }, [onOpenNote])

  const { notes } = vault.get()
  const g = buildGraph(notes)

  return (
    <div className="graph-wrap">
      <canvas ref={canvasRef} aria-label="Living knowledge graph" />
      <div className="graph-hud">
        <b>{g.nodes.length}</b> neurons · <b>{g.edges.length}</b> synapses
      </div>
      <div className="graph-legend">
        <span className="l-note">note</span>
        <span className="l-hub">hub (3+ connections)</span>
      </div>
    </div>
  )
}
