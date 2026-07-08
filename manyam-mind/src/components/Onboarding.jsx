// First-run tour (PLAN.md §6.2). A floating guide card — never a blocking
// modal, the user works in the real app the whole time: write three notes,
// make one [[link]], then the graph is revealed animating. Shown once, only
// on a genuinely fresh vault; dismissable at any step; the done flag lives
// in Dexie meta so it survives restarts and never re-triggers.

import { useEffect, useRef, useState } from 'react'
import { vault } from '../lib/store.js'
import { db } from '../lib/db.js'
import { isFreshVault, tourProgress, TOUR_META_KEY, NOTES_GOAL } from '../lib/onboarding.js'

export default function Onboarding({ onCreateNote, onShowGraph }) {
  const [stage, setStage] = useState('hidden') // hidden | welcome | notes | link | reveal | done
  const [progress, setProgress] = useState({ created: 0, linked: false })
  const startIds = useRef(new Set())

  useEffect(() => {
    let alive = true
    db.meta
      .get(TOUR_META_KEY)
      .then((row) => {
        if (!alive || row?.value) return
        if (isFreshVault(vault.get())) {
          setStage('welcome')
        } else {
          // An existing mind opened on a device that never saw the tour —
          // mark it done so it can never pop up mid-life.
          db.meta.put({ key: TOUR_META_KEY, value: true })
        }
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (stage !== 'notes' && stage !== 'link') return
    return vault.subscribe(() => {
      const p = tourProgress(vault.get(), startIds.current)
      setProgress(p)
      setStage((s) => {
        if (s === 'notes' && p.created >= NOTES_GOAL) return 'link'
        if (s === 'link' && p.linked) return 'reveal'
        return s
      })
    })
  }, [stage])

  function finish() {
    db.meta.put({ key: TOUR_META_KEY, value: true }).catch(() => {})
    setStage('hidden')
  }

  if (stage === 'hidden') return null

  return (
    <aside className="tour-card" aria-label="Getting started tour">
      {stage === 'welcome' && (
        <>
          <h4>Grow your first neurons</h4>
          <p>
            Every note is a neuron; every link, a synapse. Write three notes and connect two of
            them, and you'll see your mind come alive.
          </p>
          <div className="tour-actions">
            <button
              className="primary"
              onClick={() => {
                startIds.current = new Set(vault.get().notes.map((n) => n.id))
                setProgress({ created: 0, linked: false })
                setStage('notes')
              }}
            >
              Start
            </button>
            <button className="ghost" onClick={finish}>
              Skip tour
            </button>
          </div>
        </>
      )}

      {stage === 'notes' && (
        <>
          <h4>
            Write {NOTES_GOAL} notes — {Math.min(progress.created, NOTES_GOAL)}/{NOTES_GOAL}
          </h4>
          <p>
            Write what you know, believe, or value — a principle, a memory, a how-to. Each one
            becomes a neuron in your mind.
          </p>
          <div className="tour-actions">
            <button className="primary" onClick={onCreateNote}>
              Create a note
            </button>
            <button className="ghost" onClick={finish}>
              Skip tour
            </button>
          </div>
        </>
      )}

      {stage === 'link' && (
        <>
          <h4>Make your first synapse</h4>
          <p>
            In one of your new notes, type <code>[[</code> and pick another note to link it. Linked
            thoughts strengthen each other.
          </p>
          <div className="tour-actions">
            <button className="ghost" onClick={finish}>
              Skip tour
            </button>
          </div>
        </>
      )}

      {stage === 'reveal' && (
        <>
          <h4>Your mind is alive</h4>
          <p>Three neurons, one synapse — time to watch it move.</p>
          <div className="tour-actions">
            <button
              className="primary"
              onClick={() => {
                onShowGraph()
                setStage('done')
              }}
            >
              Reveal the graph
            </button>
            <button className="ghost" onClick={finish}>
              Skip tour
            </button>
          </div>
        </>
      )}

      {stage === 'done' && (
        <>
          <h4>This is your mind growing</h4>
          <p>
            Notes you work on glow and grow; repeated links thicken. Keep writing — and when it has
            enough signal, open <b>Persona</b> and talk to yourself.
          </p>
          <div className="tour-actions">
            <button className="primary" onClick={finish}>
              Finish
            </button>
          </div>
        </>
      )}
    </aside>
  )
}
