import { defineConfig } from '@playwright/test'

const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4179'
const hostname = new URL(baseURL).hostname
if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(hostname)) {
  throw new Error(`E2E tests may only run against localhost; got ${hostname}`)
}

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL,
    browserName: 'chromium',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'bun run e2e:server',
    url: baseURL,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { E2E_BASE_URL: baseURL },
  },
})
