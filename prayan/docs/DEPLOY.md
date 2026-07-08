# Deploying Prayan — PLAN.md §6.5

Three deployable pieces: the web app (static SPA), the Supabase backend
(migrations + Edge Functions), and the Mind API service (Railway). Desktop
bundles are covered in `docs/DESKTOP.md`.

## 1. Web app (Vercel)

`prayan/vercel.json` configures the build (Vite → `dist/`, asset caching,
security headers). In the Vercel dashboard set **Root Directory** to
`prayan/` (this is a monorepo), or deploy from the CLI:

```sh
cd prayan
npx vercel deploy --prod \
  --build-env VITE_SUPABASE_URL=https://<project-ref>.supabase.co \
  --build-env VITE_SUPABASE_ANON_KEY=<anon key>
```

Build-time env (all optional — the app degrades honestly without them):

| Var | Effect when set |
| --- | --- |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | enables auth, marketplace, sync, llm-proxy/embed calls; without them the app runs in offline demo mode |
| `VITE_MIND_API_URL` | enables the Mind API publish card |
| `VITE_SENTRY_DSN` | enables error reporting (SDK loaded only when set) |
| `VITE_TELEMETRY_URL` | enables privacy-safe usage counts |

The anon key is public by design; RLS is the security boundary
(`docs/SECURITY-REVIEW.md`).

## 2. Supabase (one project per environment)

- **Migrations**: apply `supabase/migrations/0001…0007` in order (Supabase
  MCP `apply_migration`, or `supabase db push`). All are idempotent.
- **Edge Functions**: deploy all ten directories under `supabase/functions/`
  (`supabase functions deploy <name>`); every function verifies JWTs except
  `interview-digest`, which must be deployed with `--no-verify-jwt` (it
  authenticates with the `x-cron-secret` header instead).
- **Function secrets** (Dashboard → Edge Functions → Secrets): optional
  `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY` (llm-proxy),
  `VOYAGE_API_KEY` (embed), `LLM_DAILY_TOKEN_CAP`, `PAYMENT_PROVIDER`
  (leave unset = internal escrow; Stripe on hold), `CRON_SECRET` +
  `RESEND_API_KEY` + `MAIL_FROM` + `APP_URL` (interview-digest).
- Status (2026-07-08): project `pmmzlbbjbqkariqgduej` has all 7 migrations
  applied and all 10 functions deployed. No provider keys are set yet, so
  llm-proxy/embed return honest 501s until keys are added; developer mode
  in Settings works regardless.

## 3. Mind API (Railway)

`services/mind-api/` has its own `Dockerfile`, `railway.json`, and README
with the env list (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, provider
keys, `PORT`). Point `VITE_MIND_API_URL` at the deployed URL.

## 4. Post-deploy checklist

- [ ] Open the app: onboarding tour appears on a fresh profile
- [ ] Sign up, list a mind, buy it from a second account, complete escrow
- [ ] `npm run test:e2e` against a preview URL (`PW_BASE_URL` override)
- [ ] Re-run `supabase` security advisors (see `docs/SECURITY-REVIEW.md`)
- [ ] Stripe test→live checklist: N/A while Stripe is on hold (PLAN.md §3.3)
