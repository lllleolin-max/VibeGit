import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/desktop',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: { trace: 'retain-on-failure' }
})

