/**
 * Compute a one-line summary of changes between two boycott states.
 *
 * Returns a string suitable for storing in `boycott_updates.summary` — joined
 * with " · " between change clauses — or `null` when nothing changed.
 *
 * Both `before` and `after` should have the shape:
 *   { name, description, isPublic, sourceLinks, companies: [{ id, name, block_* }] }
 */
export function buildBoycottUpdateSummary(before, after) {
  const parts = []

  const beforeIds = new Set((before.companies || []).map(c => c.id))
  const afterIds = new Set((after.companies || []).map(c => c.id))
  const added = (after.companies || []).filter(c => !beforeIds.has(c.id))
  const removed = (before.companies || []).filter(c => !afterIds.has(c.id))

  if (added.length === 1) parts.push(`Added ${added[0].name}`)
  else if (added.length > 1) parts.push(`Added ${added.length} companies`)

  if (removed.length === 1) parts.push(`Removed ${removed[0].name}`)
  else if (removed.length > 1) parts.push(`Removed ${removed.length} companies`)

  let connTypeChanges = 0
  for (const a of after.companies || []) {
    if (!beforeIds.has(a.id)) continue
    const b = (before.companies || []).find(c => c.id === a.id)
    if (!b) continue
    if (
      a.block_owns !== b.block_owns ||
      a.block_owned_by !== b.block_owned_by ||
      a.block_brands !== b.block_brands ||
      a.block_suppliers !== b.block_suppliers ||
      a.block_customers !== b.block_customers
    ) {
      connTypeChanges++
    }
  }
  if (connTypeChanges > 0) {
    parts.push(`Updated ${connTypeChanges} connection${connTypeChanges === 1 ? '' : 's'}`)
  }

  if ((before.name || '').trim() !== (after.name || '').trim()) parts.push('Renamed')
  if (before.isPublic !== after.isPublic) {
    parts.push(after.isPublic ? 'Made public' : 'Made private')
  }
  if ((before.description || '') !== (after.description || '')) parts.push('Updated description')

  const beforeLinks = new Set(before.sourceLinks || [])
  const afterLinks = new Set(after.sourceLinks || [])
  const linksDiffer =
    beforeLinks.size !== afterLinks.size || [...beforeLinks].some(l => !afterLinks.has(l))
  if (linksDiffer) parts.push('Updated sources')

  if (parts.length === 0) return null
  return parts.join(' · ')
}
