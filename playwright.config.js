import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: process.env.STAGING_URL || 'https://staging.boyk.org',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    httpCredentials: process.env.STAGING_PASSWORD
      ? { username: 'boyk', password: process.env.STAGING_PASSWORD }
      : undefined,
  },
  projects: [
    // Auth setup — runs first to create auth state
    {
      name: 'setup',
      testMatch: /auth\.setup\.js/,
    },
    // Public tests — no auth needed
    {
      name: 'public',
      testMatch: /explore\.spec\.js/,
      use: { browserName: 'chromium' },
    },
    // Authenticated tests — depend on setup
    {
      name: 'authenticated',
      testMatch:
        /company-add-to-boycott\.spec\.js|create-boycott-modal\.spec\.js|post-interactions\.spec\.js|boycott-interactions\.spec\.js|compose-flow\.spec\.js/,
      dependencies: ['setup'],
      use: {
        browserName: 'chromium',
        storageState: 'e2e/.auth/user.json',
      },
    },
  ],
})
