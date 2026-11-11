// Stand-in for Supabase in demo mode. The Supabase client is given this as its
// `fetch`, so every query the app makes is answered from the recorded snapshot
// in /demo-data/social.json instead of the network. Reads return what a
// visitor would have seen; writes are refused.

let snapshot

function loadSnapshot() {
  snapshot ||= fetch('/demo-data/social.json')
    .then(res => (res.ok ? res.json() : { rpc: {} }))
    .then(json => json.rpc || {})
    .catch(() => ({}))
  return snapshot
}

const ID_ARGS = [
  'p_user_id',
  'p_post_id',
  'p_boycott_id',
  'p_company_identifier',
  'p_target_company_id',
]

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

const READ_ONLY = { message: 'This is a read-only demo.', code: 'demo_read_only' }

function answerRpc(data, name, args) {
  if (!/^(get|search)_/.test(name)) return json(READ_ONLY, 403)

  // Recorded lists are a single page; anything past it is empty.
  if (args.p_cursor) return json([])

  if (name === 'get_feed') return json(data.feed || [])

  if (name === 'get_profiles_by_ids') {
    const ids = new Set(args.p_ids || [])
    return json((data.profiles || []).filter(p => ids.has(p.id)))
  }

  if (name === 'search_users') {
    const q = (args.p_query || '').trim().toLowerCase()
    if (!q) return json([])
    const hits = (data.profiles || []).filter(
      p => p.username?.toLowerCase().includes(q) || p.display_name?.toLowerCase().includes(q)
    )
    return json(hits.slice(0, args.p_limit || 20))
  }

  const idArg = ID_ARGS.find(key => args[key])
  const recorded = data[`${name}|${idArg ? args[idArg] : ''}`]
  if (recorded !== undefined) return json(recorded)
  return json(name.endsWith('_count') ? 0 : [])
}

export async function demoFetch(input, init = {}) {
  const url = new URL(typeof input === 'string' ? input : input.url)
  const method = (init.method || 'GET').toUpperCase()

  const rpc = url.pathname.match(/\/rest\/v1\/rpc\/([a-z0-9_]+)$/)
  if (rpc) {
    let args = {}
    try {
      args = init.body ? JSON.parse(init.body) : {}
    } catch {
      // non-JSON body — treat as no arguments
    }
    return answerRpc(await loadSnapshot(), rpc[1], args)
  }

  // Table reads (user-submitted claims, evidence) have nothing recorded.
  if (url.pathname.startsWith('/rest/v1/') && method === 'GET') return json([])

  // Auth, storage, edge functions and every write.
  return json(READ_ONLY, 403)
}
