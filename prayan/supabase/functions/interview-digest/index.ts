// POST /interview-digest — PLAN.md §5.6: the hosted interview-driven
// growth loop. For every published mind whose owner opted in
// (minds.digest_opt_in), emails a "3 questions your mind wants answered"
// digest (from minds.gap_titles, computed client-side at publish time —
// src/lib/mindPublish.js calls retrieval.knowledgeGaps and stores the
// result, rather than this function re-deriving gaps server-side against
// content it may not have full context for) with links back into the app
// at `#interview` (App.jsx opens PersonaChat in interview mode on that
// hash — see src/App.jsx).
//
// DEPLOYMENT (documented here, not in a committed config.toml — this repo
// has none; deploy with the Supabase CLI's --no-verify-jwt flag, or the
// dashboard's "Enforce JWT verification" toggle turned OFF for this
// function): `supabase functions deploy interview-digest --no-verify-jwt`.
// This function is meant to be invoked by a schedule (Supabase's
// pg_cron-based Scheduled Functions, or any external cron hitting this
// URL), not by an end user's browser session — there is no user JWT to
// verify. In place of JWT auth, every request must present the shared
// secret configured as CRON_SECRET in the header `x-cron-secret`; a
// mismatch or missing header is rejected before any database work happens.
//
// CRON SETUP (Supabase Dashboard -> Edge Functions -> Cron, or via SQL):
//   select cron.schedule(
//     'interview-digest-weekly',
//     '0 15 * * 1', -- every Monday at 15:00 UTC
//     $$ select net.http_post(
//          url := '<project-ref>.functions.supabase.co/interview-digest',
//          headers := jsonb_build_object('x-cron-secret', '<CRON_SECRET value>')
//        ) $$
//   );
//
// EMAIL (Resend, PLAN.md's amended provider choice, 2026-07-08): inert
// without RESEND_API_KEY — the function still runs, computes who *would*
// have been emailed, and returns that count, but sends nothing. This
// mirrors the rest of this codebase's "env-gated, honest about what it
// didn't do" pattern (e.g. supabase/functions/embed's 501 when no
// embedding provider is configured).

import { errorResponse, json } from '../_shared/cors.ts'
import { serviceClient } from '../_shared/db.ts'

const APP_URL_FALLBACK = 'https://prayan.app' // overridden by APP_URL env when set

interface DigestMind {
  user_id: string
  handle: string
  gap_titles: unknown
  digest_opt_in: boolean
}

function gapQuestions(mind: DigestMind): string[] {
  const titles = Array.isArray(mind.gap_titles) ? mind.gap_titles : []
  return titles.filter((t): t is string => typeof t === 'string' && t.trim().length > 0).slice(0, 3)
}

async function sendDigestEmail(params: { to: string; handle: string; questions: string[]; apiKey: string; from: string; appUrl: string }) {
  const { to, handle, questions, apiKey, from, appUrl } = params
  const interviewLink = `${appUrl}/#interview`
  const html = [
    `<p>Hi ${handle},</p>`,
    `<p>Your mind clone has a few gaps it would love your help filling in:</p>`,
    '<ul>',
    ...questions.map((q) => `<li>${q}</li>`),
    '</ul>',
    `<p><a href="${interviewLink}">Answer them now</a> — each answer becomes a new neuron in your vault.</p>`,
  ].join('\n')

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      from,
      to,
      subject: 'Your mind has 3 questions for you',
      html,
    }),
  })
  if (!res.ok) throw new Error(`Resend send failed: ${res.status} ${(await res.text()).slice(0, 200)}`)
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return errorResponse('POST only', 405)

  const cronSecret = Deno.env.get('CRON_SECRET')
  if (!cronSecret) return errorResponse('CRON_SECRET not configured on this function.', 501)
  if (req.headers.get('x-cron-secret') !== cronSecret) return errorResponse('Invalid or missing cron secret.', 401)

  try {
    const db = serviceClient()
    const { data: minds, error } = await db
      .from('minds')
      .select('user_id, handle, gap_titles, digest_opt_in')
      .eq('published', true)
      .eq('digest_opt_in', true)
    if (error) throw error

    const resendKey = Deno.env.get('RESEND_API_KEY')
    const mailFrom = Deno.env.get('MAIL_FROM') || 'mind@prayan.app'
    const appUrl = (Deno.env.get('APP_URL') || APP_URL_FALLBACK).replace(/\/+$/, '')

    let eligible = 0
    let sent = 0
    const errors: string[] = []

    for (const mind of minds || []) {
      const questions = gapQuestions(mind as DigestMind)
      if (!questions.length) continue
      eligible++

      if (!resendKey) continue // inert without a key — still counted as eligible, honestly

      try {
        const { data: userRes, error: userErr } = await db.auth.admin.getUserById(mind.user_id)
        const email = userRes?.user?.email
        if (userErr || !email) {
          errors.push(`${mind.handle}: no email on file`)
          continue
        }
        await sendDigestEmail({ to: email, handle: mind.handle, questions, apiKey: resendKey, from: mailFrom, appUrl })
        sent++
      } catch (err) {
        errors.push(`${mind.handle}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    return json({
      eligible,
      sent,
      inert: !resendKey,
      errors,
    })
  } catch (err) {
    console.error('[interview-digest]', err)
    return errorResponse('Internal error running the interview digest.', 500)
  }
})
