// User-claimed companies and connections — Supabase CRUD wrappers.
// All visibility / authorization is enforced by RLS policies; this module only
// shapes inputs and surfaces errors.

import { supabase } from '../lib/supabase'
import { getCompanyWithConnections, isNeo4jId } from './neo4jGraph'

// ── Companies ────────────────────────────────────────────────

export async function listUserCompanies(boycottId) {
  const { data, error } = await supabase
    .from('user_companies')
    .select('*')
    .eq('boycott_id', boycottId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data || []
}

export async function addUserCompany(boycottId, { name, description = null }) {
  const { data: auth } = await supabase.auth.getUser()
  const created_by = auth?.user?.id
  if (!created_by) throw new Error('not authenticated')

  const { data, error } = await supabase
    .from('user_companies')
    .insert({ boycott_id: boycottId, name, description, created_by })
    .select('*')
    .single()
  if (error) throw error
  return data
}

export async function removeUserCompany(userCompanyId) {
  const { error } = await supabase.from('user_companies').delete().eq('id', userCompanyId)
  if (error) throw error
}

// ── Connections ──────────────────────────────────────────────

export async function listUserConnections(boycottId) {
  const { data, error } = await supabase
    .from('user_connections')
    .select('*')
    .eq('boycott_id', boycottId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data || []
}

export async function addUserConnection(
  boycottId,
  { source, target, relation, relation_label = null, description = null }
) {
  const { data: auth } = await supabase.auth.getUser()
  const created_by = auth?.user?.id
  if (!created_by) throw new Error('not authenticated')

  const { data, error } = await supabase
    .from('user_connections')
    .insert({
      boycott_id: boycottId,
      source_kind: source.kind,
      source_id: String(source.id),
      target_kind: target.kind,
      target_id: String(target.id),
      relation,
      relation_label: relation === 'other' ? relation_label : null,
      description,
      created_by,
    })
    .select('*')
    .single()
  if (error) throw error
  return data
}

export async function removeUserConnection(userConnectionId) {
  const { error } = await supabase.from('user_connections').delete().eq('id', userConnectionId)
  if (error) throw error
}

// ── Evidence (polymorphic on user_company | user_connection) ─────────────

export async function listEvidence(parentKind, parentId) {
  const { data, error } = await supabase
    .from('user_evidence')
    .select('*')
    .eq('attaches_kind', parentKind)
    .eq('attaches_id', parentId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data || []
}

export async function addEvidence(
  parentKind,
  parentId,
  { url, quote = null, source_label = null, accessed_at = null }
) {
  const { data: auth } = await supabase.auth.getUser()
  const created_by = auth?.user?.id
  if (!created_by) throw new Error('not authenticated')

  const { data, error } = await supabase
    .from('user_evidence')
    .insert({
      attaches_kind: parentKind,
      attaches_id: parentId,
      url,
      quote,
      source_label,
      accessed_at: accessed_at || new Date().toISOString(),
      created_by,
    })
    .select('*')
    .single()
  if (error) throw error
  return data
}

export async function removeEvidence(evidenceId) {
  const { error } = await supabase.from('user_evidence').delete().eq('id', evidenceId)
  if (error) throw error
}

// ── Votes (agreement / disagreement on user-claims) ───────────────

// Cast or flip a vote. UPSERT so the call is idempotent if the user already
// voted: same stance is a no-op, different stance flips it. Use removeVote
// to withdraw entirely.
export async function setVote(targetKind, targetId, stance) {
  const { data: auth } = await supabase.auth.getUser()
  const voter_id = auth?.user?.id
  if (!voter_id) throw new Error('not authenticated')
  if (!['agree', 'disagree'].includes(stance)) throw new Error('bad stance')

  const { data, error } = await supabase
    .from('user_claim_votes')
    .upsert(
      { target_kind: targetKind, target_id: targetId, voter_id, stance },
      { onConflict: 'target_kind,target_id,voter_id' }
    )
    .select('*')
    .single()
  if (error) throw error
  return data
}

export async function removeVote(targetKind, targetId) {
  const { data: auth } = await supabase.auth.getUser()
  const voter_id = auth?.user?.id
  if (!voter_id) throw new Error('not authenticated')
  const { error } = await supabase
    .from('user_claim_votes')
    .delete()
    .eq('target_kind', targetKind)
    .eq('target_id', targetId)
    .eq('voter_id', voter_id)
  if (error) throw error
}

// Convenience: fetch companies + connections + evidence + vote aggregates for
// a boycott in one bundle. votes is keyed by `${kind}:${id}` and looks like
// { agree: N, disagree: M, mine: 'agree' | 'disagree' | null }.
export async function fetchBoycottUserClaims(boycottId) {
  const [companies, connections] = await Promise.all([
    listUserCompanies(boycottId),
    listUserConnections(boycottId),
  ])
  if (companies.length === 0 && connections.length === 0) {
    return { companies: [], connections: [], evidence: {}, votes: {} }
  }
  const companyIds = companies.map(c => c.id)
  const connectionIds = connections.map(c => c.id)

  const evidenceOr = [
    companyIds.length
      ? `and(attaches_kind.eq.user_company,attaches_id.in.(${companyIds.join(',')}))`
      : null,
    connectionIds.length
      ? `and(attaches_kind.eq.user_connection,attaches_id.in.(${connectionIds.join(',')}))`
      : null,
  ]
    .filter(Boolean)
    .join(',')

  const votesOr = [
    companyIds.length
      ? `and(target_kind.eq.user_company,target_id.in.(${companyIds.join(',')}))`
      : null,
    connectionIds.length
      ? `and(target_kind.eq.user_connection,target_id.in.(${connectionIds.join(',')}))`
      : null,
  ]
    .filter(Boolean)
    .join(',')

  // Collect unique Neo4j ids referenced by user_connections so we can resolve
  // them to display names. Skip ids that don't pass isNeo4jId — they're either
  // user-company refs (handled locally) or stale.
  const neo4jIds = new Set()
  for (const cn of connections) {
    if (cn.source_kind === 'neo4j' && isNeo4jId(cn.source_id)) neo4jIds.add(cn.source_id)
    if (cn.target_kind === 'neo4j' && isNeo4jId(cn.target_id)) neo4jIds.add(cn.target_id)
  }

  const [evidenceRes, votesRes, authRes, neo4jLookup] = await Promise.all([
    supabase.from('user_evidence').select('*').or(evidenceOr),
    supabase.from('user_claim_votes').select('*').or(votesOr),
    supabase.auth.getUser(),
    resolveNeo4jNames([...neo4jIds]),
  ])
  if (evidenceRes.error) throw evidenceRes.error
  if (votesRes.error) throw votesRes.error

  const me = authRes?.data?.user?.id

  const evidence = {}
  for (const row of evidenceRes.data || []) {
    const key = `${row.attaches_kind}:${row.attaches_id}`
    if (!evidence[key]) evidence[key] = []
    evidence[key].push(row)
  }

  const votes = {}
  for (const row of votesRes.data || []) {
    const key = `${row.target_kind}:${row.target_id}`
    if (!votes[key]) votes[key] = { agree: 0, disagree: 0, mine: null }
    if (row.stance === 'agree') votes[key].agree += 1
    else if (row.stance === 'disagree') votes[key].disagree += 1
    if (me && row.voter_id === me) votes[key].mine = row.stance
  }

  return { companies, connections, evidence, votes, neo4jNames: neo4jLookup }
}

// Resolve a list of Neo4j ids to { id: { name, logo_url } }.
//
// Used to be an unbounded Promise.all over getCompanyWithConnections —
// 50 user-claim refs meant 50 parallel heavy graph queries per detail-page
// load. We now dedupe inputs and cap concurrency at 4 so a single page
// can't saturate the Neo4j connection pool.
//
// Failures fall back to undefined so the UI can use the raw id as a
// placeholder instead of crashing.
const NEO4J_RESOLVE_CONCURRENCY = 4

async function resolveNeo4jNames(ids) {
  if (!ids.length) return {}
  const uniqueIds = [...new Set(ids)]

  const out = {}
  let cursor = 0
  async function worker() {
    while (cursor < uniqueIds.length) {
      const id = uniqueIds[cursor++]
      try {
        const data = await getCompanyWithConnections(id)
        if (!data) continue
        const company = data.company || data
        out[id] = { name: company?.name || id, logo_url: company?.logo_url || null }
      } catch {
        // Leave id unresolved; UI will use the raw id.
      }
    }
  }

  const workerCount = Math.min(NEO4J_RESOLVE_CONCURRENCY, uniqueIds.length)
  await Promise.all(Array.from({ length: workerCount }, worker))
  return out
}
