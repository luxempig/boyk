import { describe, expect, it } from 'vitest'

import { DESKTOP_ORDER, isTouchDevice, MOBILE_EXTRA, SHARE_TARGETS } from '../shareTargets'

const opts = {
  url: 'https://boyk.org/post/abc-123',
  short: 'A short message',
  long: 'A longer message with more detail',
}

describe('shareTargets URL builders', () => {
  it('all DESKTOP_ORDER entries exist in SHARE_TARGETS', () => {
    for (const key of DESKTOP_ORDER) {
      expect(SHARE_TARGETS[key], `missing target: ${key}`).toBeDefined()
    }
  })

  it('all MOBILE_EXTRA entries exist in SHARE_TARGETS', () => {
    for (const key of MOBILE_EXTRA) {
      expect(SHARE_TARGETS[key], `missing target: ${key}`).toBeDefined()
    }
  })

  it('DESKTOP_ORDER excludes sms', () => {
    expect(DESKTOP_ORDER).not.toContain('sms')
  })

  it('Twitter uses intent/tweet with text and url', () => {
    const built = SHARE_TARGETS.twitter.build(opts)
    expect(built).toMatch(/^https:\/\/twitter\.com\/intent\/tweet\?/)
    expect(built).toContain('text=A%20short%20message')
    expect(built).toContain('url=')
  })

  it('appends UTM params to the shared URL', () => {
    const built = SHARE_TARGETS.twitter.build(opts)
    const taggedFragment = encodeURIComponent('utm_source=twitter')
    expect(built).toContain(taggedFragment)
    expect(built).toContain(encodeURIComponent('utm_medium=share'))
  })

  it('WhatsApp embeds URL inside text (no separate url param)', () => {
    const built = SHARE_TARGETS.whatsapp.build(opts)
    expect(built).toMatch(/^https:\/\/wa\.me\/\?text=/)
    expect(built).toContain('utm_source%3Dwhatsapp')
  })

  it('Facebook uses sharer.php with only the URL', () => {
    const built = SHARE_TARGETS.facebook.build(opts)
    expect(built).toMatch(/^https:\/\/www\.facebook\.com\/sharer\/sharer\.php\?u=/)
    expect(built).toContain('utm_source%3Dfacebook')
  })

  it('LinkedIn uses sharing/share-offsite', () => {
    const built = SHARE_TARGETS.linkedin.build(opts)
    expect(built).toMatch(/^https:\/\/www\.linkedin\.com\/sharing\/share-offsite\/\?url=/)
  })

  it('Reddit includes title from short message', () => {
    const built = SHARE_TARGETS.reddit.build(opts)
    expect(built).toMatch(/^https:\/\/www\.reddit\.com\/submit\?/)
    expect(built).toContain('title=A%20short%20message')
  })

  it('Telegram uses t.me/share/url with text param', () => {
    const built = SHARE_TARGETS.telegram.build(opts)
    expect(built).toMatch(/^https:\/\/t\.me\/share\/url\?/)
    expect(built).toContain('text=')
  })

  it('Threads embeds URL in text (no url param)', () => {
    const built = SHARE_TARGETS.threads.build(opts)
    expect(built).toMatch(/^https:\/\/www\.threads\.net\/intent\/post\?/)
    expect(built).toContain('text=')
    expect(built).toContain('utm_source%3Dthreads')
  })

  it('Bluesky uses intent/compose with full text', () => {
    const built = SHARE_TARGETS.bluesky.build(opts)
    expect(built).toMatch(/^https:\/\/bsky\.app\/intent\/compose\?/)
  })

  it('Email uses mailto: with subject and body', () => {
    const built = SHARE_TARGETS.email.build(opts)
    expect(built).toMatch(/^mailto:\?/)
    expect(built).toContain('subject=A%20short%20message')
    expect(built).toContain('body=')
  })

  it('SMS uses sms:&body= (works on iOS and Android)', () => {
    const built = SHARE_TARGETS.sms.build(opts)
    expect(built).toMatch(/^sms:&body=/)
  })

  it('escapes special characters in the shared text', () => {
    const built = SHARE_TARGETS.twitter.build({
      ...opts,
      short: 'Hello & welcome to Boyk?',
    })
    expect(built).toContain('Hello%20%26%20welcome%20to%20Boyk%3F')
  })

  it('preserves utm_source for each platform name', () => {
    const platforms = [
      'twitter',
      'whatsapp',
      'facebook',
      'linkedin',
      'reddit',
      'telegram',
      'threads',
      'bluesky',
      'email',
      'sms',
    ]
    for (const p of platforms) {
      const built = SHARE_TARGETS[p].build(opts)
      // utm appears either decoded (in URL params) or double-encoded (in text-embedded URLs)
      const ok = built.includes(`utm_source=${p}`) || built.includes(`utm_source%3D${p}`)
      expect(ok, `utm_source missing for ${p}: ${built.slice(0, 200)}`).toBe(true)
    }
  })
})

describe('isTouchDevice', () => {
  it('returns a boolean without throwing', () => {
    expect(typeof isTouchDevice()).toBe('boolean')
  })
})
