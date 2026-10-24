import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  testMatch: 'app.spec.ts',
  workers: 1,
  timeout: 30_000
})
