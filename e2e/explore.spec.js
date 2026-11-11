import { expect, test } from '@playwright/test'

test.describe('Explore Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/explore')
    // Wait for the page content to load
    await page.waitForLoadState('networkidle')
  })

  test('displays "Explore Boycotts" heading instead of "All Public Boycotts"', async ({ page }) => {
    // The heading should say "Explore Boycotts" (not "All Public Boycotts")
    const heading = page.locator('text=/Explore Boycotts/')
    await expect(heading).toBeVisible({ timeout: 10000 })

    // Verify old text is NOT present
    const oldHeading = page.locator('text=/All Public Boycotts/')
    await expect(oldHeading).not.toBeVisible()
  })

  test('explore heading includes boycott count', async ({ page }) => {
    // Should show count in parentheses like "Explore Boycotts (N)"
    const heading = page.locator('text=/Explore Boycotts \\(\\d+\\)/')
    await expect(heading).toBeVisible({ timeout: 10000 })
  })

  test('visual: explore page matches expected layout', async ({ page }) => {
    // Wait for boycotts to load
    await page.waitForSelector('text=/Explore Boycotts/', { timeout: 10000 })

    // Take a screenshot for visual comparison
    await expect(page).toHaveScreenshot('explore-page.png', {
      maxDiffPixelRatio: 0.05,
      fullPage: false,
    })
  })
})
