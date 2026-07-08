// Entry point — starts the HTTP server. Railway (railway.json) runs
// `npm start`, which runs this file.

import { createApp } from './app.js'

const port = Number(process.env.PORT) || 8787
const app = createApp()

app.listen(port, () => {
  console.log(`[mind-api] listening on :${port}`)
})
