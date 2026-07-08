// GET /minds/:handle          -> public profile JSON (from the `public_minds` view)
// GET /minds/:handle/page     -> a small, self-contained HTML public profile page
//
// Both 404 for a handle that doesn't exist OR isn't published — the
// `public_minds` view (migration 0006_minds.sql) only contains published
// rows, so "doesn't exist" and "unpublished" are indistinguishable by
// design (no need to leak which one it is).

import { Router } from 'express'

async function fetchPublicMind(supabase, handle) {
  const { data, error } = await supabase.from('public_minds').select('*').eq('handle', handle).maybeSingle()
  if (error) throw new Error(`public_minds lookup failed: ${error.message}`)
  return data
}

function esc(s = '') {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

/**
 * Renders the public mind page as one self-contained HTML document — no
 * external CSS/JS/font requests, dark palette. The inline `<style>` below
 * hardcodes a small palette that intentionally MIRRORS the tokens in
 * prayan/src/styles/brand.css (--ink-0 #1e1e1e, --ink-1 #262626,
 * --ink-2 #363636, --glow-syn #a882ff, --paper #dcddde) — this is a
 * server-rendered document, not an app component, so CLAUDE.md's "no
 * hardcoded colors in components" rule (which targets src/components/*)
 * doesn't apply verbatim here, but the values are kept in lockstep by
 * hand rather than invented independently. If brand.css ever changes,
 * update these to match.
 */
export function renderMindPage(mind, { apiBaseUrl = '' } = {}) {
  const questions = Array.isArray(mind.sample_questions) ? mind.sample_questions : []
  const priceLine =
    mind.price_per_query_cents > 0
      ? `$${(mind.price_per_query_cents / 100).toFixed(2)}/query after ${mind.free_queries_per_day} free/day`
      : `${mind.free_queries_per_day} free queries/day`

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(mind.handle)} — a Prayan mind</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; padding: 40px 20px;
    background: #1e1e1e; color: #dcddde;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  }
  main { max-width: 640px; margin: 0 auto; }
  h1 { font-size: 28px; margin: 0 0 4px; }
  .tagline { color: #999; margin: 0 0 24px; }
  .card { background: #262626; border: 1px solid #363636; border-radius: 10px; padding: 20px; margin-bottom: 16px; }
  .stats { display: flex; gap: 20px; font-size: 13px; color: #999; }
  .stats b { color: #dcddde; }
  .badge { display: inline-block; font-size: 11px; padding: 3px 8px; border-radius: 99px; background: #363636; color: #a882ff; }
  .questions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
  .questions button {
    background: #1e1e1e; border: 1px solid #363636; color: #dcddde; border-radius: 8px;
    padding: 8px 12px; font-size: 13px; cursor: pointer;
  }
  .questions button:hover { border-color: #a882ff; }
  #log { display: flex; flex-direction: column; gap: 10px; margin-bottom: 12px; min-height: 20px; }
  .msg { padding: 10px 12px; border-radius: 8px; font-size: 14px; line-height: 1.5; white-space: pre-wrap; }
  .msg.user { background: #363636; align-self: flex-end; }
  .msg.mind { background: #2f2b40; }
  form { display: flex; gap: 8px; }
  input[type=text] {
    flex: 1; background: #1e1e1e; border: 1px solid #363636; border-radius: 8px;
    color: #dcddde; padding: 10px 12px; font-size: 14px;
  }
  button.primary {
    background: #7f6df2; color: #fff; border: none; border-radius: 8px;
    padding: 10px 16px; font-size: 14px; cursor: pointer;
  }
  pre { background: #1e1e1e; border: 1px solid #363636; border-radius: 8px; padding: 12px; overflow-x: auto; font-size: 12px; }
</style>
</head>
<body>
<main>
  <h1>${esc(mind.handle)}</h1>
  <p class="tagline">a hosted mind clone — a personal model built from one person's own knowledge</p>
  <div class="card">
    <p>${esc(mind.bio || 'This mind has not written a bio yet.')}</p>
    <div class="stats">
      <span><b>${mind.note_count ?? 0}</b> neurons</span>
      <span><b>${mind.link_count ?? 0}</b> synapses</span>
      <span class="badge">${esc(priceLine)}</span>
    </div>
    ${questions.length ? `<div class="questions">${questions.map((q) => `<button type="button" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>` : ''}
  </div>
  <div class="card">
    <div id="log"></div>
    <form id="ask-form">
      <input id="ask-input" type="text" placeholder="Ask this mind anything…" autocomplete="off" />
      <button class="primary" type="submit">Ask</button>
    </form>
  </div>
  <div class="card">
    <p style="margin:0 0 8px;color:#999;font-size:13px;">Programmatic access:</p>
    <pre>curl -X POST ${esc(apiBaseUrl)}/minds/${esc(mind.handle)}/ask \\
  -H "content-type: application/json" \\
  -d '{"question": "${questions[0] ? esc(questions[0]).replace(/"/g, '\\"') : 'What do you believe?'}"}'</pre>
  </div>
</main>
<script>
  var API_BASE = ${JSON.stringify(apiBaseUrl)};
  var HANDLE = ${JSON.stringify(mind.handle)};
  var log = document.getElementById('log');
  function addMsg(role, text) {
    var d = document.createElement('div');
    d.className = 'msg ' + role;
    d.textContent = text;
    log.appendChild(d);
  }
  function ask(question) {
    if (!question) return;
    addMsg('user', question);
    fetch(API_BASE + '/minds/' + HANDLE + '/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: question }),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) { addMsg('mind', data.answer || data.error || 'No answer.'); })
      .catch(function (err) { addMsg('mind', 'Error: ' + err.message); });
  }
  document.getElementById('ask-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var input = document.getElementById('ask-input');
    ask(input.value.trim());
    input.value = '';
  });
  Array.prototype.forEach.call(document.querySelectorAll('.questions button'), function (btn) {
    btn.addEventListener('click', function () { ask(btn.getAttribute('data-q')); });
  });
</script>
</body>
</html>`
}

export function mindsRouter({ supabase, apiBaseUrl = '' }) {
  const router = Router()

  router.get('/minds/:handle', async (req, res) => {
    try {
      const mind = await fetchPublicMind(supabase, req.params.handle)
      if (!mind) return res.status(404).json({ error: 'No published mind at this handle.' })
      res.json(mind)
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  router.get('/minds/:handle/page', async (req, res) => {
    try {
      const mind = await fetchPublicMind(supabase, req.params.handle)
      if (!mind) return res.status(404).send('No published mind at this handle.')
      res.set('content-type', 'text/html; charset=utf-8').send(renderMindPage(mind, { apiBaseUrl }))
    } catch (err) {
      res.status(500).send(`Internal error: ${esc(err.message)}`)
    }
  })

  return router
}
