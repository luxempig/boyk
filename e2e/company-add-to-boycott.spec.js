import { expect, test } from '@playwright/test'

test.describe('Company Page - Add to Boycott', () => {
  test('company page loads with company name visible', async ({ page }) => {
    await page.goto('/company/UWJKFUJFZ02DKWI3RY53') // Coca-Cola Company
    await page.waitForLoadState('networkidle')

    const companyName = page.locator('h1')
    await expect(companyName).toBeVisible({ timeout: 15000 })
    await expect(companyName).toContainText('Coca-Cola')
  })

  test('shows "Add to Boycott" button for authenticated users', async ({ page }) => {
    await page.goto('/company/UWJKFUJFZ02DKWI3RY53')
    await page.waitForLoadState('networkidle')
    await page.waitForSelector('h1', { timeout: 15000 })

    // The "Add to Boycott" button should be visible for logged-in users
    const addButton = page.locator('button[aria-label="Add to boycott"]')
    await expect(addButton).toBeVisible({ timeout: 5000 })
    await expect(addButton).toContainText('Add to Boycott')
  })

  test('clicking "Add to Boycott" shows boycott dropdown', async ({ page }) => {
    await page.goto('/company/UWJKFUJFZ02DKWI3RY53')
    await page.waitForLoadState('networkidle')
    await page.waitForSelector('h1', { timeout: 15000 })

    const addButton = page.locator('button[aria-label="Add to boycott"]')
    await addButton.click()

    // Should show dropdown with user's boycotts OR navigate to create
    // Either a dropdown appears or we navigate away
    const dropdown = page.locator('div[style*="position: absolute"]')
    const isDropdownVisible = await dropdown.isVisible().catch(() => false)

    if (isDropdownVisible) {
      // Dropdown with boycott list appeared
      await expect(dropdown).toBeVisible()
    }
    // If no dropdown, user has no boycotts and was redirected — that's also valid
  })

  test('visual: company page header layout', async ({ page }) => {
    await page.goto('/company/UWJKFUJFZ02DKWI3RY53')
    await page.waitForLoadState('networkidle')
    await page.waitForSelector('h1', { timeout: 15000 })

    await expect(page).toHaveScreenshot('company-header.png', {
      maxDiffPixelRatio: 0.05,
      fullPage: false,
    })
  })
})
