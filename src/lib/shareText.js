/**
 * Builds the share text for a Boyk entity. This shapes how every shared
 * post / boycott / scan reads when it lands on Twitter, WhatsApp, email, etc.
 *
 * Two outputs:
 *   - short:  ≤240 chars — Twitter, Reddit title, email subject.
 *             Twitter intent appends "?url=..." after the text, which costs
 *             ~25 chars in the rendered tweet, so leave headroom.
 *   - long:   any length — WhatsApp, email body, Telegram, Threads, Bluesky.
 *
 * The URL is appended automatically by shareTargets.js — DO NOT include it
 * in the text. (Facebook/LinkedIn ignore user text entirely and scrape the
 * OG preview, so those two are unaffected by what you return here.)
 *
 * Inputs:
 *   { type: 'post' | 'boycott' | 'scan', data: { ... } }
 *
 * Returns:
 *   { short, long }
 */
export function buildShareText({ type, data }) {
  // TODO(daniel): define the voice. Stubs below get you a functional menu
  // immediately — replace them with real copy when you're ready. Keep `short`
  // under 240 chars; truncate boycott names / post content as needed.

  if (type === 'post') {
    // data: { content, author_display_name, author_username, boycott_name? }
    const author = data.author_display_name || data.author_username || 'Someone'
    const snippet = truncate(data.content || '', 180)
    return {
      short: `${author} on Boyk: "${snippet}"`,
      long: `${author} posted on Boyk:\n\n"${data.content || ''}"`,
    }
  }

  if (type === 'boycott') {
    // data: { name, description?, adopter_count? }
    const name = data.name || 'this boycott'
    const adopters = data.adopter_count
      ? ` — joined by ${data.adopter_count.toLocaleString()} people`
      : ''
    return {
      short: truncate(`Join the boycott of ${name}${adopters}`, 240),
      long: data.description
        ? `${name}\n\n${data.description}${adopters ? `\n\n${adopters.trim()}` : ''}`
        : `${name}${adopters}`,
    }
  }

  if (type === 'scan') {
    // data: { company_name, product_name?, boycott_name?, reason? }
    const co = data.company_name || 'This product'
    const lines = [`${co} is BOYCOTTED`]
    if (data.boycott_name) lines.push(`Boycott: ${data.boycott_name}`)
    if (data.reason) lines.push(data.reason)
    return {
      short: truncate(`${co} is BOYCOTTED — check yours at boyk.org`, 240),
      long: lines.join('\n'),
    }
  }

  return { short: 'Check this out on Boyk', long: 'Check this out on Boyk' }
}

function truncate(text, max) {
  if (!text || text.length <= max) return text
  const cut = text.slice(0, max - 1)
  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut) + '…'
}
