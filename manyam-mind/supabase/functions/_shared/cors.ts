// CORS for marketplace Edge Functions. All functions here are called from
// the app's own origin via supabase-js `functions.invoke`, but browsers
// still preflight cross-origin fetches, so every function must answer
// OPTIONS and echo these headers on every response (including errors).

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}

/** Returns a 200 OPTIONS response if this is a preflight request, else null. */
export function handlePreflight(req: Request): Response | null {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  return null
}

export function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { ...corsHeaders, 'content-type': 'application/json', ...(init.headers || {}) },
  })
}

export function errorResponse(message: string, status = 400): Response {
  return json({ error: message }, { status })
}
