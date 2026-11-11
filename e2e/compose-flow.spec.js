import { expect, test } from '@playwright/test'

/**
 * Covers the full post-compose flow: opening the modal from BottomNav,
 * typing content, publishing, and seeing the new post appear on the feed.
 *
 * Leaves a test post behind tagged with a [e2e] marker — they're cheap to
 * clean up manually and safer than relying on a brittle delete path.
 */
test.describe.configure({ mode: 'serial' })

test.describe('Compose flow', () => {
  test('open modal, publish a text post, see it in the feed', async ({ page }) => {
    await page.goto('/feed')
    await page.waitForLoadState('networkidle')

    await page.getByTestId('bottomnav-create-button').click()
    await page.getByTestId('create-menu-post').click()

    const textarea = page.getByTestId('compose-textarea')
    await expect(textarea).toBeVisible({ timeout: 10000 })

    const marker = `[e2e ${Date.now()}] smoke post`
    await textarea.fill(marker)

    await page.getByTestId('compose-submit-button').click()

    // Modal should close + post should appear in feed.
    await expect(textarea).toHaveCount(0, { timeout: 15000 })
    await expect(page.getByText(marker).first()).toBeVisible({ timeout: 15000 })
  })

  test('submit button is disabled when textarea is empty', async ({ page }) => {
    await page.goto('/feed')
    await page.waitForLoadState('networkidle')

    await page.getByTestId('bottomnav-create-button').click()
    await page.getByTestId('create-menu-post').click()

    const submitBtn = page.getByTestId('compose-submit-button')
    await expect(submitBtn).toBeDisabled({ timeout: 5000 })
  })
})
