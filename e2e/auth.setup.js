import { test } from '@playwright/test'

/**
 * Logs into the app via the login page and stores auth state.
 * Run this before authenticated test suites.
 */
test('authenticate', async ({ page }) => {
  const email = process.env.TEST_EMAIL
  const password = process.env.TEST_PASSWORD
  if (!email || !password) {
    throw new Error(
      'TEST_EMAIL and TEST_PASSWORD environment variables must be set to run authenticated E2E tests.'
    )
  }

  await page.goto('/login')
  await page.waitForLoadState('networkidle')

  // Fill email (type='text' on login page) and password
  await page.fill('input[autocomplete="username"]', email)
  await page.fill('input[type="password"]', password)

  // Click Sign In
  await page.click('button[type="submit"]')

  // Wait for navigation away from login page
  // After login, app redirects to home/profile — just wait for login page to go away
  await page.waitForFunction(() => !window.location.pathname.includes('/login'), { timeout: 15000 })

  // Save auth state for reuse
  await page.context().storageState({ path: 'e2e/.auth/user.json' })
})
