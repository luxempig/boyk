#!/usr/bin/env node
/**
 * Records the public, read-only Supabase responses the site needs into
 * public/demo-data/social.json, so the frozen demo runs without a database.
 *
 *   node scripts/demo/snapshot-social.mjs accounts.json
 *
 * accounts.json is { allow: [userId...], deny: [userId...] }: content from
 * "allow" accounts (the seeded demo personas) is kept; anything that mentions
 * a "deny" account is dropped. Two optional lists curate the sample content:
 * omitPosts (post ids to leave out) and unlinkCompanies (boycott ids whose
 * company links are left out, where sample data tied a real company to a
 * claim nobody checked). Uses the anon key, so it can only ever see what a
 * logged-out visitor could.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync(new URL('../../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter(l => /^[A-Z_0-9]+=/.test(l))
    .map(l => [
      l.slice(0, l.indexOf('=')),
      l
        .slice(l.indexOf('=') + 1)
        .trim()
        .replace(/^["']|["']$/g, ''),
    ])
)
const URL_BASE = env.VITE_SUPABASE_URL
const KEY = env.VITE_SUPABASE_ANON_KEY
const {
  allow,
  deny,
  omitPosts = [],
  unlinkCompanies = [],
} = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const denied = new Set(deny)

async function rpc(name, args = {}) {
  const res = await fetch(`${URL_BASE}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  if (!res.ok) {
    console.warn(`  ${name} ${JSON.stringify(args)} -> ${res.status}`)
    return null
  }
  return scrub(await res.json())
}

// Drop any object that references a denied account anywhere inside it.
function mentionsDenied(v) {
  if (typeof v === 'string') return denied.has(v)
  if (Array.isArray(v)) return v.some(mentionsDenied)
  if (v && typeof v === 'object') return Object.values(v).some(mentionsDenied)
  return false
}
function scrub(v) {
  if (Array.isArray(v))
    return v.filter(x => !(x && typeof x === 'object' && mentionsDenied(x))).map(scrub)
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrub(x)]))
  }
  return v
}

const out = {}
const save = (name, id, data) => {
  if (data !== null && data !== undefined) out[`${name}|${id ?? ''}`] = data
}

const boycotts = ((await rpc('get_public_boycotts')) || [])
  .map(b => (unlinkCompanies.includes(b.id) ? { ...b, boycott_companies: [] } : b))
  // Boycotts that list companies show the feature best, so they go first.
  .sort((a, b) => (b.boycott_companies?.length || 0) - (a.boycott_companies?.length || 0))
save('get_public_boycotts', '', boycotts)
save('get_users_by_followers', '', await rpc('get_users_by_followers', { p_limit: 20 }))

const profiles = []
const postIds = new Set()
for (const id of allow) {
  const profile = await rpc('get_profile', { p_user_id: id })
  save('get_profile', id, profile)
  if (profile?.[0]) profiles.push(profile[0])
  for (const fn of [
    'get_my_boycotts',
    'get_followed_boycotts',
    'get_followers',
    'get_follower_count',
    'get_following_with_profiles',
    'get_following_count',
  ]) {
    const data = await rpc(fn, { p_user_id: id })
    // get_my_boycotts would also return private boycotts to their owner; the
    // anon key never sees those, but keep only public ones regardless.
    save(
      fn,
      id,
      fn === 'get_my_boycotts' && Array.isArray(data)
        ? data.filter(b => b.is_public !== false)
        : data
    )
  }
  const posts = (
    (await rpc('get_user_posts', { p_user_id: id, p_cursor: null, p_limit: 20 })) || []
  ).filter(p => !omitPosts.includes(p.id))
  save('get_user_posts', id, posts)
  for (const p of posts) {
    postIds.add(p.id)
    if (p.original_post_id) postIds.add(p.original_post_id)
  }
}
out.profiles = profiles

const feed = []
for (const id of postIds) {
  const post = await rpc('get_post', { p_post_id: id })
  if (!post || (Array.isArray(post) && !post.length)) continue
  save('get_post', id, post)
  save('get_post_replies', id, await rpc('get_post_replies', { p_post_id: id, p_limit: 200 }))
  feed.push(Array.isArray(post) ? post[0] : post)
}
out.feed = feed.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))

const companyIds = new Set()
for (const b of boycotts) {
  save('get_boycott_comments', b.id, await rpc('get_boycott_comments', { p_boycott_id: b.id }))
  for (const bc of b.boycott_companies || []) {
    for (const cid of [bc.companies?.lei, bc.companies?.wikidata_qid, bc.companies?.id]) {
      if (cid) companyIds.add(cid)
    }
  }
}
for (const cid of companyIds) {
  const data = await rpc('get_boycotts_for_company', { p_company_identifier: cid })
  if (Array.isArray(data) && data.length) save('get_boycotts_for_company', cid, data)
}

const file = new URL('../../public/demo-data/social.json', import.meta.url)
writeFileSync(file, JSON.stringify({ generatedAt: new Date().toISOString(), rpc: out }))
console.log(
  `${boycotts.length} boycotts, ${profiles.length} profiles, ${feed.length} posts, ${Object.keys(out).length} entries`
)
