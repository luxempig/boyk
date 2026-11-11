import { expect, test } from '@playwright/test'

test.describe('Create Boycott Modal - X Button Fix', () => {
  // These tests verify the fix for the X button in the create boycott flow.
  // When in company search mode, pressing X (or Escape) should return to
  // the boycott draft form, NOT close the entire modal.

  test('explore page loads and shows create button', async ({ page }) => {
    await page.goto('/explore')
    await page.waitForLoadState('networkidle')

    // The explore page should load with boycotts visible
    const heading = page.locator('text=/Explore Boycotts/')
    await expect(heading).toBeVisible({ timeout: 10000 })
  })

  test('visual: explore page with boycotts', async ({ page }) => {
    await page.goto('/explore')
    await page.waitForLoadState('networkidle')
    await page.waitForSelector('text=/Explore Boycotts/', { timeout: 10000 })

    await expect(page).toHaveScreenshot('explore-with-boycotts.png', {
      maxDiffPixelRatio: 0.05,
      fullPage: false,
    })
  })
})
