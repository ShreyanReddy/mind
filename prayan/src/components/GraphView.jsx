// GraphView — the living network, production grade (PLAN.md §2).
//
// The force simulation (Barnes-Hut repulsion + springs + centering — pure,
// tested code in src/lib/graphPhysics.js) runs in a Web Worker
// (src/workers/graphSim.js) that streams transferable Float32Array position
// buffers back; this component only draws. Rendering deliberately stays on a
// main-thread canvas: drawing needs live theme tokens, labels, hover, focus
// and search state, and the expensive part (the simulation) is already off
// the main thread — OffscreenCanvas would add complexity for no measurable
// win (decision documented in CHANGELOG, Phase 2). Where Worker is
// unavailable (jsdom, old browsers) the identical physics module steps on
// the main thread instead.
//
// Neurons glow with growth (mass/radius/brightness from vault.graphEnriched,
// PLAN.md §2.2), recently-edited nodes pulse, new synapses fire a traveling
// spark, 90-day-idle edges fade but never break. HUD: whole-mind/local
// scope, search-to-highlight, folder cluster colors, and the "Watch your
// mind grow" time-lapse built from the durable Dexie activity log.

import { useEffect, useRef, useState } from 'react'
import { vault } from '../lib/store.js'
import { db } from '../lib/db.js'
import {
  createSim,
  syncSim,
  stepSim,
  pinNode,
  unpinNode,
  runToRest,
} from '../lib/graphPhysics.js'
import { neighborhood, timelapseFrame, FADE_FLOOR_ALPHA } from '../lib/growth.js'
import { folderColor } from '../lib/palette.js'

const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim()

const LAPSE_SWEEP_MS = 8000 // full time-lapse sweep ≈ 8s
const LAPSE_SYNC_MS = 90 // sim re-sync throttle while scrubbing
const MAX_LEGEND_FOLDERS = 6

// PLAN.md §2.4 — reduced motion renders a static, run-to-convergence layout.
const REDUCED_MOTION =
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** The most recently active note that still exists — local mode's default center. */
function defaultLocalCenter() {
  const { notes, activity } = vault.get()
  for (let i = activity.length - 1; i >= 0; i--) {
    const id = activity[i].noteId
    if (notes.some((n) => n.id === id)) return id
  }
  return notes[0]?.id ?? null
}

export default function GraphView({ onOpenNote }) {
  const canvasRef = useRef(null)
  const apiRef = useRef(null) // engine controls, set by the mount effect
  const uiRef = useRef({ scope: 'all', localCenter: null, search: '', lapse: null })
  const openNoteRef = useRef(onOpenNote)

  const [scope, setScope] = useState('all')
  const [localCenter, setLocalCenter] = useState(null)
  const [search, setSearch] = useState('')
  const [lapse, setLapse] = useState(null) // { acts, minT, maxT, t: 0..1, playing }
  const [counts, setCounts] = useState({ nodes: 0, edges: 0 })
  const [folders, setFolders] = useState([])
  const [hover, setHover] = useState(null) // { x, y, title }
  const [announce, setAnnounce] = useState('')

  useEffect(() => {
    openNoteRef.current = onOpenNote
  }, [onOpenNote])

  // ---------------- engine (canvas + sim backend), mounted once ----------------
  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext?.('2d')
    if (!canvas || !ctx) return undefined // jsdom / no 2d context

    const S = {
      meta: new Map(), // id -> node meta (title, folder, color, radius01, …)
      order: [], // draw order (node ids)
      edges: [],
      pos: new Map(), // id -> { x, y } render positions
      lastPos: new Map(), // never pruned — position seeds for re-appearing nodes
      sparks: [],
      drag: null,
      pan: { x: 0, y: 0 },
      zoom: 1,
      focusId: null,
      hoverId: null,
      matches: new Set(),
      matchList: [],
      matchIdx: -1,
      posIds: [], // node order of the worker's position buffers
      posVersion: 0,
    }

    const colors = {
      syn: css('--glow-syn') || '#58e6d9',
      mind: css('--glow-mind') || '#8f7bff',
      dim: css('--paper-dim') || '#9aa5c0',
      paper: css('--paper') || '#dcddde',
    }
    const folderColorCache = new Map()
    const clusterColor = (base, folder) => {
      const key = base + '|' + folder
      let c = folderColorCache.get(key)
      if (!c) {
        c = folderColor(base, folder)
        folderColorCache.set(key, c)
      }
      return c
    }

    const view = () => ({ width: canvas.width, height: canvas.height })

    // Simulation backend: Web Worker when available; otherwise the same
    // physics module on the main thread (jsdom/tests/old browsers). Reduced
    // motion always uses the main-thread sim: it runs to convergence once
    // per data change instead of animating (PLAN.md §2.4).
    const useWorker = typeof Worker !== 'undefined' && !REDUCED_MOTION
    let worker = null
    let sim = null
    if (useWorker) {
      worker = new Worker(new URL('../workers/graphSim.js', import.meta.url), { type: 'module' })
      worker.onmessage = (e) => {
        const m = e.data
        if (m.type === 'topology') {
          S.posIds = m.ids
          S.posVersion = m.v
          const keep = new Set(m.ids)
          for (const id of [...S.pos.keys()]) if (!keep.has(id)) S.pos.delete(id)
        } else if (m.type === 'positions' && m.v === S.posVersion) {
          for (let i = 0; i < S.posIds.length; i++) {
            const id = S.posIds[i]
            if (S.drag?.id === id) continue // pointer owns the dragged node
            let p = S.pos.get(id)
            if (!p) {
              p = { x: 0, y: 0 }
              S.pos.set(id, p)
            }
            p.x = m.buf[i * 2]
            p.y = m.buf[i * 2 + 1]
            S.lastPos.set(id, p)
          }
        }
      }
    } else {
      sim = createSim()
    }

    function syncPosFromSim() {
      for (const n of sim.nodes) {
        let p = S.pos.get(n.id)
        if (!p) {
          p = { x: 0, y: 0 }
          S.pos.set(n.id, p)
        }
        p.x = n.x
        p.y = n.y
        S.lastPos.set(n.id, p)
      }
      for (const id of [...S.pos.keys()]) if (!sim.byId.has(id)) S.pos.delete(id)
    }

    function simSync() {
      const nodes = S.order.map((id) => {
        const m = S.meta.get(id)
        const seed = S.lastPos.get(id)
        const n = { id, mass: m.mass }
        if (seed) {
          n.x = seed.x
          n.y = seed.y
        }
        return n
      })
      const edges = S.edges.map((e) => ({ a: e.a, b: e.b, w: e.weight ?? e.w }))
      if (worker) {
        worker.postMessage({ type: 'sync', nodes, edges, view: view() })
      } else {
        syncSim(sim, nodes, edges, view())
        if (REDUCED_MOTION) {
          runToRest(sim, view(), 300)
          syncPosFromSim()
          requestDraw()
        }
      }
    }

    // ---------------- data pipeline ----------------

    function currentFrame() {
      const ui = uiRef.current
      if (ui.lapse) {
        const { acts, minT, maxT, t } = ui.lapse
        const T = minT + (maxT - minT) * t
        const g = vault.graph() // base topology; w = repeated-link count
        return timelapseFrame({ notes: vault.get().notes, edges: g.edges, activity: acts }, T, {
          recentWindow: Math.max(60000, (maxT - minT) * 0.03),
        })
      }
      let g = vault.graphEnriched()
      if (ui.scope === 'local' && ui.localCenter) g = neighborhood(g, ui.localCenter, 2)
      return g
    }

    let prevEdgeKeys = new Set()
    let lastLapseSync = 0
    let lapseSyncTimer = null

    function refresh() {
      const ui = uiRef.current
      const g = currentFrame()

      S.meta = new Map()
      S.order = []
      for (const n of g.nodes) {
        const hub = n.degree >= 3
        const color = clusterColor(hub ? colors.mind : colors.syn, n.folder || '')
        S.meta.set(n.id, { ...n, hub, color })
        S.order.push(n.id)
      }
      S.edges = g.edges

      // new synapse? fire a traveling spark (live mode with motion only)
      const keys = new Set(g.edges.map((e) => e.a + '~' + e.b))
      if (!REDUCED_MOTION && !ui.lapse) {
        for (const e of g.edges) {
          const k = e.a + '~' + e.b
          if (!prevEdgeKeys.has(k) && prevEdgeKeys.size) S.sparks.push({ a: e.a, b: e.b, t: 0 })
        }
      }
      prevEdgeKeys = keys

      if (S.focusId && !S.meta.has(S.focusId)) S.focusId = null
      if (S.hoverId && !S.meta.has(S.hoverId)) {
        S.hoverId = null
        setHover(null)
      }

      computeMatches()

      // Sim re-sync — throttled while the time-lapse scrubs (a trailing sync
      // always catches the final position).
      if (ui.lapse) {
        const now = performance.now()
        if (now - lastLapseSync >= LAPSE_SYNC_MS) {
          lastLapseSync = now
          simSync()
        } else if (!lapseSyncTimer) {
          lapseSyncTimer = setTimeout(() => {
            lapseSyncTimer = null
            lastLapseSync = performance.now()
            simSync()
          }, LAPSE_SYNC_MS)
        }
      } else {
        simSync()
      }

      // HUD state (identity-guarded so refresh can run inside effects)
      setCounts((c) =>
        c.nodes === g.nodes.length && c.edges === g.edges.length
          ? c
          : { nodes: g.nodes.length, edges: g.edges.length }
      )
      const folderCounts = new Map()
      for (const n of g.nodes) {
        if (n.folder) folderCounts.set(n.folder, (folderCounts.get(n.folder) || 0) + 1)
      }
      const top = [...folderCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, MAX_LEGEND_FOLDERS)
        .map(([name]) => ({ name, color: clusterColor(colors.syn, name) }))
      setFolders((f) =>
        f.length === top.length && f.every((x, i) => x.name === top[i].name) ? f : top
      )

      if (REDUCED_MOTION) requestDraw()
    }

    function computeMatches() {
      const q = uiRef.current.search.trim().toLowerCase()
      S.matches = new Set()
      S.matchList = []
      if (!q) {
        S.matchIdx = -1
        return
      }
      for (const id of S.order) {
        const m = S.meta.get(id)
        const hay = [m.title, ...(m.aliases || []), ...(m.tags || [])]
        if (hay.some((h) => h && h.toLowerCase().includes(q))) {
          S.matches.add(id)
          S.matchList.push(id)
        }
      }
      if (S.matchIdx >= S.matchList.length) S.matchIdx = -1
    }

    // ---------------- canvas sizing ----------------

    function resize() {
      const r = canvas.parentElement.getBoundingClientRect()
      canvas.width = r.width * devicePixelRatio
      canvas.height = r.height * devicePixelRatio
      canvas.style.width = r.width + 'px'
      canvas.style.height = r.height + 'px'
      if (worker) worker.postMessage({ type: 'view', view: view() })
      if (REDUCED_MOTION) requestDraw()
    }
    resize()
    let ro = null
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(resize)
      ro.observe(canvas.parentElement)
    }

    // ---------------- drawing ----------------

    const radiusPx = (m) => 4 + 14 * (m.radius01 ?? 0.3)

    function draw(t) {
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.setTransform(S.zoom, 0, 0, S.zoom, S.pan.x, S.pan.y)

      const searching = uiRef.current.search.trim().length > 0

      // synapses — faded (90-day consolidation) edges thin to a floor
      // opacity but are always drawn: old memories fade, they don't die.
      for (const e of S.edges) {
        const a = S.pos.get(e.a)
        const b = S.pos.get(e.b)
        if (!a || !b) continue
        const w = e.weight ?? e.w
        let alpha = e.faded ? FADE_FLOOR_ALPHA : Math.min(0.65, 0.14 + w * 0.12)
        if (searching && !(S.matches.has(e.a) && S.matches.has(e.b))) alpha *= 0.2
        ctx.strokeStyle = colors.syn
        ctx.globalAlpha = alpha
        ctx.lineWidth = (e.faded ? 0.6 : Math.min(4, w)) * devicePixelRatio * 0.7
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        ctx.stroke()
      }
      ctx.globalAlpha = 1

      // sparks travel along new synapses (never under reduced motion)
      if (!REDUCED_MOTION) {
        S.sparks = S.sparks.filter((s) => s.t < 1)
        for (const s of S.sparks) {
          const a = S.pos.get(s.a)
          const b = S.pos.get(s.b)
          if (!a || !b) {
            s.t = 1
            continue
          }
          s.t += 0.02
          const x = a.x + (b.x - a.x) * s.t
          const y = a.y + (b.y - a.y) * s.t
          ctx.fillStyle = colors.syn
          ctx.shadowColor = colors.syn
          ctx.shadowBlur = 18
          ctx.beginPath()
          ctx.arc(x, y, 3.5 * devicePixelRatio, 0, 7)
          ctx.fill()
          ctx.shadowBlur = 0
        }
      }

      // neurons — size/glow from growth semantics, color from folder cluster
      const ui = uiRef.current
      for (const id of S.order) {
        const m = S.meta.get(id)
        const p = S.pos.get(id)
        if (!p) continue
        const dimmed = searching && !S.matches.has(id)
        const pulse = !REDUCED_MOTION && m.recent ? 1 + 0.25 * Math.sin(t / 160) : 1
        const r = radiusPx(m) * devicePixelRatio * pulse

        ctx.globalAlpha = dimmed ? 0.2 : 1
        ctx.fillStyle = m.color
        ctx.shadowColor = m.color
        const glow = m.recent && !REDUCED_MOTION ? 26 : 6 + 20 * (m.brightness ?? 0.5)
        ctx.shadowBlur = (searching && S.matches.has(id) ? glow + 14 : glow) * pulse
        ctx.beginPath()
        ctx.arc(p.x, p.y, r, 0, 7)
        ctx.fill()
        ctx.shadowBlur = 0

        // keyboard focus ring / local-mode center ring
        const ringed =
          S.focusId === id || (!ui.lapse && ui.scope === 'local' && ui.localCenter === id)
        if (ringed) {
          ctx.strokeStyle = colors.paper
          ctx.lineWidth = 1.5 * devicePixelRatio
          ctx.setLineDash([4 * devicePixelRatio, 3 * devicePixelRatio])
          ctx.beginPath()
          ctx.arc(p.x, p.y, r + 6 * devicePixelRatio, 0, 7)
          ctx.stroke()
          ctx.setLineDash([])
        }

        if (
          !dimmed &&
          (r > 6 * devicePixelRatio || S.zoom > 1.3 || S.focusId === id || S.hoverId === id)
        ) {
          ctx.fillStyle = colors.dim
          ctx.font = `${11 * devicePixelRatio}px Inter, sans-serif`
          ctx.textAlign = 'center'
          ctx.fillText(m.title.slice(0, 24), p.x, p.y + r + 14 * devicePixelRatio)
        }
        ctx.globalAlpha = 1
      }
    }

    let alive = true
    let raf = 0
    let drawQueued = false
    /** One-shot draw for reduced motion / static redraw paths. */
    function requestDraw() {
      if (!alive || drawQueued) return
      drawQueued = true
      requestAnimationFrame((t) => {
        drawQueued = false
        if (alive) draw(t)
      })
    }
    if (!REDUCED_MOTION) {
      const loop = (t) => {
        if (!alive) return
        if (sim) {
          // no-Worker fallback: same physics, stepped on the main thread
          stepSim(sim, view())
          syncPosFromSim()
        }
        draw(t)
        raf = requestAnimationFrame(loop)
      }
      raf = requestAnimationFrame(loop)
    }

    // ---------------- pointer interaction ----------------

    const toWorld = (e) => {
      const r = canvas.getBoundingClientRect()
      return {
        x: ((e.clientX - r.left) * devicePixelRatio - S.pan.x) / S.zoom,
        y: ((e.clientY - r.top) * devicePixelRatio - S.pan.y) / S.zoom,
      }
    }
    const hit = (p) => {
      for (const id of S.order) {
        const m = S.meta.get(id)
        const q = S.pos.get(id)
        if (!q) continue
        const r = radiusPx(m) * devicePixelRatio + 6
        if ((q.x - p.x) ** 2 + (q.y - p.y) ** 2 < r * r) return id
      }
      return null
    }

    function clickNode(id) {
      const ui = uiRef.current
      if (!ui.lapse && ui.scope === 'local' && ui.localCenter !== id) {
        // local mode: clicking re-centers; click the center (or press Enter) to open
        setLocalCenter(id)
      } else {
        openNoteRef.current?.(id)
      }
    }

    let moved = false
    const down = (e) => {
      const p = toWorld(e)
      const id = hit(p)
      moved = false
      S.drag = id ? { id } : { pan: true, sx: e.clientX, sy: e.clientY, px: S.pan.x, py: S.pan.y }
    }
    const move = (e) => {
      if (!S.drag) return
      moved = true
      if (S.drag.id) {
        const p = toWorld(e)
        const q = S.pos.get(S.drag.id)
        if (q) {
          q.x = p.x
          q.y = p.y
        }
        // the dragged node is pinned in the sim and follows the pointer
        if (worker) worker.postMessage({ type: 'pin', id: S.drag.id, x: p.x, y: p.y })
        else if (sim) pinNode(sim, S.drag.id, p.x, p.y)
      } else {
        S.pan.x = S.drag.px + (e.clientX - S.drag.sx) * devicePixelRatio
        S.pan.y = S.drag.py + (e.clientY - S.drag.sy) * devicePixelRatio
      }
      if (REDUCED_MOTION) requestDraw()
    }
    const up = () => {
      if (S.drag?.id) {
        if (worker) worker.postMessage({ type: 'unpin', id: S.drag.id })
        else if (sim) unpinNode(sim, S.drag.id)
        if (!moved) clickNode(S.drag.id)
      }
      S.drag = null
    }
    const hoverMove = (e) => {
      if (S.drag) return
      const id = hit(toWorld(e))
      if (id === S.hoverId) return
      S.hoverId = id
      const m = id ? S.meta.get(id) : null
      const rect = canvas.getBoundingClientRect()
      setHover(
        m ? { x: e.clientX - rect.left + 14, y: e.clientY - rect.top + 12, title: m.title } : null
      )
      if (REDUCED_MOTION) requestDraw()
    }
    const wheel = (e) => {
      e.preventDefault()
      S.zoom = Math.min(3, Math.max(0.35, S.zoom * (e.deltaY < 0 ? 1.1 : 0.9)))
      if (REDUCED_MOTION) requestDraw()
    }

    // ---------------- keyboard navigation (PLAN.md §2.4) ----------------

    function ensureVisible(id) {
      const p = S.pos.get(id)
      if (!p) return
      const sx = p.x * S.zoom + S.pan.x
      const sy = p.y * S.zoom + S.pan.y
      const mgn = 60 * devicePixelRatio
      if (sx < mgn || sx > canvas.width - mgn || sy < mgn || sy > canvas.height - mgn) {
        S.pan.x = canvas.width / 2 - p.x * S.zoom
        S.pan.y = canvas.height / 2 - p.y * S.zoom
      }
    }

    function focusNode(id, { pan = false } = {}) {
      S.focusId = id
      const m = id ? S.meta.get(id) : null
      setAnnounce(m ? `${m.title}. ${m.degree} connection${m.degree === 1 ? '' : 's'}.` : '')
      if (id && pan) ensureVisible(id)
      if (REDUCED_MOTION) requestDraw()
    }

    function moveFocus(dx, dy) {
      if (!S.order.length) return
      const cur = S.focusId ? S.pos.get(S.focusId) : null
      if (!cur) {
        // nothing focused yet — start from the node nearest the view center
        const c = {
          x: (canvas.width / 2 - S.pan.x) / S.zoom,
          y: (canvas.height / 2 - S.pan.y) / S.zoom,
        }
        let best = null
        let bd = Infinity
        for (const id of S.order) {
          const p = S.pos.get(id)
          if (!p) continue
          const d = (p.x - c.x) ** 2 + (p.y - c.y) ** 2
          if (d < bd) {
            bd = d
            best = id
          }
        }
        if (best) focusNode(best, { pan: true })
        return
      }
      // nearest node inside a ~56° cone in the pressed direction
      let best = null
      let bestScore = Infinity
      for (const id of S.order) {
        if (id === S.focusId) continue
        const p = S.pos.get(id)
        if (!p) continue
        const vx = p.x - cur.x
        const vy = p.y - cur.y
        const along = vx * dx + vy * dy
        if (along <= 0) continue
        const perp = Math.abs(vx * dy - vy * dx)
        if (perp > along * 1.5) continue
        const score = along + perp * 2
        if (score < bestScore) {
          bestScore = score
          best = id
        }
      }
      if (best) focusNode(best, { pan: true })
    }

    const DIRS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
    const onKey = (e) => {
      if (DIRS[e.key]) {
        e.preventDefault()
        moveFocus(DIRS[e.key][0], DIRS[e.key][1])
      } else if (e.key === 'Enter' && S.focusId) {
        e.preventDefault()
        openNoteRef.current?.(S.focusId)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        focusNode(null)
      }
    }

    canvas.addEventListener('mousedown', down)
    canvas.addEventListener('mousemove', hoverMove)
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    canvas.addEventListener('wheel', wheel, { passive: false })
    canvas.addEventListener('keydown', onKey)

    // search Enter cycles matches and pans to them
    function cycleMatch() {
      if (!S.matchList.length) return
      S.matchIdx = (S.matchIdx + 1) % S.matchList.length
      const id = S.matchList[S.matchIdx]
      const p = S.pos.get(id)
      if (p) {
        S.pan.x = canvas.width / 2 - p.x * S.zoom
        S.pan.y = canvas.height / 2 - p.y * S.zoom
      }
      S.focusId = id
      const m = S.meta.get(id)
      setAnnounce(`Match ${S.matchIdx + 1} of ${S.matchList.length}: ${m.title}`)
      if (REDUCED_MOTION) requestDraw()
    }

    apiRef.current = { refresh, cycleMatch }

    const unsub = vault.subscribe(refresh)
    refresh()

    return () => {
      alive = false
      cancelAnimationFrame(raf)
      if (lapseSyncTimer) clearTimeout(lapseSyncTimer)
      unsub()
      ro?.disconnect()
      worker?.terminate()
      canvas.removeEventListener('mousedown', down)
      canvas.removeEventListener('mousemove', hoverMove)
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      canvas.removeEventListener('wheel', wheel)
      canvas.removeEventListener('keydown', onKey)
      apiRef.current = null
    }
  }, [])

  // UI state → engine: mirror into the ref the engine reads, then refresh.
  useEffect(() => {
    uiRef.current = { scope, localCenter, search, lapse }
    apiRef.current?.refresh()
  }, [scope, localCenter, search, lapse])

  // Time-lapse playback: sweep t 0→1 over ~8s. Never runs under reduced
  // motion (playing is never set true there).
  const playing = Boolean(lapse?.playing)
  useEffect(() => {
    if (!playing) return undefined
    let raf = 0
    let last = performance.now()
    const tick = (now) => {
      const dt = now - last
      last = now
      setLapse((l) => {
        if (!l || !l.playing) return l
        const t = Math.min(1, l.t + dt / LAPSE_SWEEP_MS)
        return { ...l, t, playing: t < 1 }
      })
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing])

  async function enterLapse() {
    // The FULL durable activity log — Dexie keeps up to 5,000 events even
    // though the in-memory copy is capped at 500.
    let acts
    try {
      acts = await db.activity.orderBy('t').toArray()
    } catch {
      acts = []
    }
    const notes = vault.get().notes
    let minT = Date.now()
    for (const n of notes) if (n.createdAt && n.createdAt < minT) minT = n.createdAt
    if (acts.length && acts[0].t < minT) minT = acts[0].t
    setLapse({ acts, minT, maxT: Date.now(), t: 0, playing: !REDUCED_MOTION })
  }

  const goLocal = () => {
    setScope('local')
    if (!localCenter) setLocalCenter(defaultLocalCenter())
  }

  const lapseT = lapse ? lapse.minT + (lapse.maxT - lapse.minT) * lapse.t : 0

  return (
    <div className="graph-wrap">
      <canvas
        ref={canvasRef}
        tabIndex={0}
        aria-label="Living knowledge graph. Arrow keys move between notes, Enter opens the focused note, Escape clears focus."
      />

      <div className="graph-hud">
        <b>{counts.nodes}</b> neurons · <b>{counts.edges}</b> synapses
        {lapse && <span> · {new Date(lapseT).toLocaleDateString()}</span>}
      </div>

      <div className="graph-controls">
        <div className="graph-scope" role="group" aria-label="Graph scope">
          <button
            className={scope === 'all' && !lapse ? 'on' : ''}
            onClick={() => setScope('all')}
            disabled={Boolean(lapse)}
          >
            Whole mind
          </button>
          <button
            className={scope === 'local' && !lapse ? 'on' : ''}
            onClick={goLocal}
            disabled={Boolean(lapse)}
          >
            Around this note
          </button>
        </div>
        <input
          className="graph-search"
          type="search"
          value={search}
          placeholder="Highlight notes…"
          aria-label="Search graph. Enter cycles through matches."
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              apiRef.current?.cycleMatch()
            } else if (e.key === 'Escape') {
              setSearch('')
            }
          }}
        />
        <button
          className={'graph-lapse-btn' + (lapse ? ' on' : '')}
          onClick={() => (lapse ? setLapse(null) : enterLapse())}
        >
          {lapse ? 'Back to now' : 'Watch your mind grow'}
        </button>
      </div>

      {lapse && (
        <div className="graph-timelapse" aria-label="Watch your mind grow">
          <button
            onClick={() =>
              setLapse((l) => l && { ...l, playing: !l.playing, t: l.t >= 1 ? 0 : l.t })
            }
            aria-label={lapse.playing ? 'Pause time-lapse' : 'Play time-lapse'}
            disabled={REDUCED_MOTION}
            title={
              REDUCED_MOTION ? 'Autoplay is off (reduced motion) — drag the scrubber' : undefined
            }
          >
            {lapse.playing ? '❚❚' : '▶'}
          </button>
          <input
            type="range"
            min="0"
            max="1000"
            value={Math.round(lapse.t * 1000)}
            aria-label="Time-lapse position"
            onChange={(e) =>
              setLapse((l) => l && { ...l, t: Number(e.target.value) / 1000, playing: false })
            }
          />
          <span className="lapse-label">Watch your mind grow</span>
        </div>
      )}

      <div className="graph-legend">
        <span className="l-note">note</span>
        <span className="l-hub">hub (3+ connections)</span>
        {folders.map((f) => (
          <span key={f.name} className="l-folder">
            <i style={{ background: f.color }} />
            {f.name}
          </span>
        ))}
      </div>

      {hover && (
        <div className="graph-tooltip" style={{ left: hover.x, top: hover.y }}>
          {hover.title}
        </div>
      )}

      <div className="visually-hidden" aria-live="polite" role="status">
        {announce}
      </div>
    </div>
  )
}
