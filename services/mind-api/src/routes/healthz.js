import { Router } from 'express'

export function healthzRouter() {
  const router = Router()
  router.get('/healthz', (req, res) => {
    res.json({ ok: true })
  })
  return router
}
