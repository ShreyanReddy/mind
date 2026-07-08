// E2E config (PLAN.md §6.3). Runs the critical paths against the real
// production build (`vite build` + `vite preview`) in real Chromium — no
// mocks, no jsdom. Local: `npx playwright test`. CI: the `e2e` job in
// .github/workflows/ci.yml.
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
    // Some sandboxes pre-install Chromium at a fixed path instead of
    // Playwright's cache; honor it when present.
    launchOptions: process.env.PW_CHROMIUM_PATH
      ? { executablePath: process.env.PW_CHROMIUM_PATH }
      : {},
  },
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    port: 4173,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
})
