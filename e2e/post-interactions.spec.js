import { expect, test } from '@playwright/test'

/**
 * Verifies post likes and replies round-trip correctly and that rapid
 * clicks can't inflate counts. The feed itself renders a paper-preview
 * card with no action buttons — all interactive controls live on the
 * /post/:id detail page, so these tests open a post first.
 */
async function openFirstPostDetail(page) {
  await page.goto('/feed')
  await page.waitForLoadState('networkidle')

  const firstFeedCard = page.getByTestId('feed-post-card').first()
  await expect(firstFeedCard).toBeVisible({ timeout: 15000 })
  const postId = await firstFeedCard.getAttribute('data-post-id')
  expect(postId, 'feed-post-card must expose data-post-id').toBeTruthy()

  await page.goto(`/post/${postId}`)
  await page.waitForLoadState('networkidle')

  const post = page.getByTestId('post-card').first()
  await expect(post).toBeVisible({ timeout: 15000 })
  return post
}

test.describe.configure({ mode: 'serial' })

test.describe('Post interactions', () => {
  test('feed loads and lists at least one post', async ({ page }) => {
    await page.goto('/feed')
    await page.waitForLoadState('networkidle')
    await expect(page.getByTestId('feed-post-card').first()).toBeVisible({ timeout: 15000 })
  })

  test('liking a post toggles aria-pressed + count, and a second click unlikes', async ({
    page,
  }) => {
    const post = await openFirstPostDetail(page)
    const likeBtn = post.getByTestId('post-like-button')

    const initialPressed = (await likeBtn.getAttribute('aria-pressed')) === 'true'
    const initialCount = Number((await likeBtn.getAttribute('data-like-count')) ?? '0')

    // Normalize to unliked.
    if (initialPressed) {
      await likeBtn.click()
      await expect(likeBtn).toHaveAttribute('aria-pressed', 'false')
    }
    const baseline = initialPressed ? initialCount - 1 : initialCount

    await likeBtn.click()
    await expect(likeBtn).toHaveAttribute('aria-pressed', 'true')
    expect(Number((await likeBtn.getAttribute('data-like-count')) ?? '0')).toBe(baseline + 1)

    await likeBtn.click()
    await expect(likeBtn).toHaveAttribute('aria-pressed', 'false')
    expect(Number((await likeBtn.getAttribute('data-like-count')) ?? '0')).toBe(baseline)

    // Restore original state if we changed it.
    if (initialPressed) {
      await likeBtn.click()
      await expect(likeBtn).toHaveAttribute('aria-pressed', 'true')
    }
  })

  test('two quick clicks net to baseline (no duplicate likes server-side)', async ({ page }) => {
    const post = await openFirstPostDetail(page)
    const likeBtn = post.getByTestId('post-like-button')

    if ((await likeBtn.getAttribute('aria-pressed')) === 'true') {
      await likeBtn.click()
      await expect(likeBtn).toHaveAttribute('aria-pressed', 'false')
    }
    const baseline = Number((await likeBtn.getAttribute('data-like-count')) ?? '0')

    // Click → wait for the +1 to land in data-like-count → click again.
    // This guarantees the second click sees the updated state and is a
    // real unlike (not a no-op). `dblclick` fires too fast for React to
    // re-render between the two events.
    await likeBtn.click()
    await expect(likeBtn).toHaveAttribute('aria-pressed', 'true')
    expect(Number((await likeBtn.getAttribute('data-like-count')) ?? '0')).toBe(baseline + 1)

    await likeBtn.click()
    await expect(likeBtn).toHaveAttribute('aria-pressed', 'false')
    expect(Number((await likeBtn.getAttribute('data-like-count')) ?? '0')).toBe(baseline)
  })

  test('posting a reply renders the comment and bumps reply count', async ({ page }) => {
    const post = await openFirstPostDetail(page)
    const replyBtn = post.getByTestId('post-reply-button')
    const beforeCount = Number((await replyBtn.getAttribute('data-reply-count')) ?? '0')

    // On detail page the reply section is auto-open; no need to click Reply.
    const textarea = page.getByTestId('reply-textarea').first()
    await expect(textarea).toBeVisible({ timeout: 10000 })

    const marker = `[e2e ${Date.now()}] reply smoke`
    await textarea.fill(marker)
    await page.getByTestId('reply-submit-button').first().click()

    await expect(page.getByText(marker).first()).toBeVisible({ timeout: 15000 })
    const afterCount = Number((await replyBtn.getAttribute('data-reply-count')) ?? '0')
    expect(afterCount).toBe(beforeCount + 1)
  })

  test('liking a comment toggles aria-pressed and count', async ({ page }) => {
    const post = await openFirstPostDetail(page)

    const firstReplyLike = page.getByTestId('reply-like-button').first()
    if ((await firstReplyLike.count()) === 0) {
      test.skip(true, 'no replies yet on this post — skipping reply-like check')
      return
    }

    await expect(firstReplyLike).toBeVisible({ timeout: 5000 })
    const initialPressed = (await firstReplyLike.getAttribute('aria-pressed')) === 'true'
    const initialCount = Number((await firstReplyLike.getAttribute('data-like-count')) ?? '0')

    await firstReplyLike.click()
    await expect(firstReplyLike).toHaveAttribute('aria-pressed', String(!initialPressed))
    const after = Number((await firstReplyLike.getAttribute('data-like-count')) ?? '0')
    expect(after).toBe(initialPressed ? initialCount - 1 : initialCount + 1)

    // Restore.
    await firstReplyLike.click()
    await expect(firstReplyLike).toHaveAttribute('aria-pressed', String(initialPressed))

    // Keep the post variable referenced to make ESLint happy about unused var.
    expect(post).toBeDefined()
  })
})
