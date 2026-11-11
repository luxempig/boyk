import { expect, test } from '@playwright/test'

/**
 * Explore renders paper-preview boycott cards (visual-only, click-to-navigate).
 * The interactive Follow button lives on /boycott/:id — these tests pick the
 * first boycott id from the list and exercise the detail page.
 *
 * Each test restores initial Follow state so repeated runs stay clean.
 */
async function findNonOwnedBoycottDetailUrl(page) {
  await page.goto('/explore')
  await page.waitForLoadState('networkidle')

  const cards = page.getByTestId('feed-boycott-card')
  const count = await cards.count()
  expect(count, 'explore must have at least one boycott').toBeGreaterThan(0)

  // Walk the list until we find one where the current user isn't the owner
  // (owner view renders Edit instead of Follow — no toggle to test).
  for (let i = 0; i < count; i++) {
    const id = await cards.nth(i).getAttribute('data-boycott-id')
    if (!id) continue
    await page.goto(`/boycott/${id}`)
    await page.waitForLoadState('networkidle')
    if ((await page.getByTestId('boycott-detail-follow-button').count()) > 0) return id
  }
  return null
}

test.describe.configure({ mode: 'serial' })

test.describe('Boycott interactions', () => {
  test('explore renders at least one boycott card', async ({ page }) => {
    await page.goto('/explore')
    await page.waitForLoadState('networkidle')
    await expect(page.getByTestId('feed-boycott-card').first()).toBeVisible({ timeout: 15000 })
  })

  test('Follow button on detail page flips label on click', async ({ page }) => {
    const boycottId = await findNonOwnedBoycottDetailUrl(page)
    if (!boycottId) {
      test.skip(true, 'no non-owned boycotts available to test Follow button')
      return
    }

    const followBtn = page.getByTestId('boycott-detail-follow-button')
    await expect(followBtn).toBeVisible({ timeout: 10000 })
    const initialText = ((await followBtn.textContent()) || '').trim()
    const wasFollowing = /Following/.test(initialText)

    await followBtn.click()
    await expect(followBtn).toHaveText(wasFollowing ? /Follow$/ : /Following/, { timeout: 5000 })
  })

  test('two sequenced clicks on Follow net to the original state', async ({ page }) => {
    const boycottId = await findNonOwnedBoycottDetailUrl(page)
    if (!boycottId) {
      test.skip(true, 'no non-owned boycotts available')
      return
    }

    const followBtn = page.getByTestId('boycott-detail-follow-button')
    await expect(followBtn).toBeVisible({ timeout: 10000 })
    const initialText = ((await followBtn.textContent()) || '').trim()
    const wasFollowing = /Following/.test(initialText)

    // First click: flip to the opposite state.
    await followBtn.click()
    await expect(followBtn).toHaveText(wasFollowing ? /Follow$/ : /Following/, { timeout: 5000 })

    // Second click: flip back. Confirms adopt/unadopt are both reachable —
    // and that adopting an already-unique-row succeeds (covered by the
    // enforce_unique_boycott_adoption migration).
    await followBtn.click()
    await expect(followBtn).toHaveText(wasFollowing ? /Following/ : /Follow$/, { timeout: 5000 })
  })
})
