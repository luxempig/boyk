/**
 * Lightweight @mention renderer for post content.
 *
 * Splits a string into an array of plain text + mention chunks. Mentions are
 * detected by a leading `@` followed by 1-40 word characters. The component
 * doing the rendering decides whether each mention is wrapped in a Link
 * (when post.company_mentions is available and contains the name) or a
 * styled span (visual signal only).
 *
 * Returns: [{ kind: 'text' | 'mention', value: string }, …]
 */
export function tokenizeContent(content) {
  if (!content) return []
  const out = []
  const re = /(^|\s)(@[\w][\w'.-]{0,40})/g
  const matches = [...content.matchAll(re)]
  let lastIndex = 0
  for (const m of matches) {
    const fullMatchStart = m.index + m[1].length
    if (fullMatchStart > lastIndex) {
      out.push({ kind: 'text', value: content.slice(lastIndex, fullMatchStart) })
    }
    out.push({ kind: 'mention', value: m[2] })
    lastIndex = fullMatchStart + m[2].length
  }
  if (lastIndex < content.length) {
    out.push({ kind: 'text', value: content.slice(lastIndex) })
  }
  return out
}

/** Build a name → id map from a post's company_mentions array (if present). */
export function mentionMapOf(post) {
  if (!post?.company_mentions || !Array.isArray(post.company_mentions)) return {}
  const map = {}
  for (const m of post.company_mentions) {
    if (m?.name && m?.id) map[m.name.toLowerCase()] = m.id
  }
  return map
}
