/**
 * Boyk Neo4j API Server
 * REST API for querying company graph data from Neo4j
 */

import * as Sentry from '@sentry/node'
import compression from 'compression'
import cors from 'cors'
import express from 'express'
import rateLimit from 'express-rate-limit'
import neo4j from 'neo4j-driver'
import NodeCache from 'node-cache'

const app = express()

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'production',
    // Errors only: request tracing would spend the free plan's quota.
    sendDefaultPii: false,
  })
}
const PORT = process.env.PORT || 3001

// Trust proxy headers (Cloudflare Workers forward via X-Forwarded-For)
app.set('trust proxy', 1)

const NEO4J_URI = process.env.NEO4J_URI || 'neo4j+s://localhost:7687'
const NEO4J_USER = process.env.NEO4J_USER || 'neo4j'
const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD

if (!NEO4J_PASSWORD) {
  console.error('NEO4J_PASSWORD environment variable is required')
  process.exit(1)
}

const driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD), {
  maxConnectionPoolSize: 50,
})

app.use(
  cors({
    origin: [
      'https://boyk.org',
      'https://www.boyk.org',
      'https://staging.boyk.org',
      'https://boyk.pages.dev',
      'http://localhost:5173',
      'http://localhost:4173',
    ],
  })
)
app.use(compression())
app.use(express.json({ limit: '16kb' }))

// Rate limiting — 200 requests per 15 minutes per IP. The health endpoint is
// exempt so monitoring/uptime probes don't consume (or get throttled by) the
// budget.
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
  skip: req => req.originalUrl.split('?')[0] === '/api/health',
})
app.use('/api/', apiLimiter)

// Tag all API responses with data source for cache/fallback detection
app.use('/api/', (req, res, next) => {
  res.set('X-Data-Source', 'neo4j-live')
  next()
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Convert Neo4j Integer/Date types to plain JS values (recursive)
function toJs(val) {
  if (val === null || val === undefined) return null
  if (neo4j.isInt(val)) return val.toNumber()
  if (neo4j.isDate?.(val) || neo4j.isDateTime?.(val) || neo4j.isLocalDateTime?.(val))
    return val.toString()
  if (Array.isArray(val)) return val.map(toJs)
  if (typeof val === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(val)) out[k] = toJs(v)
    return out
  }
  return val
}

// Server-side transaction timeout (ms). Bounds pathological queries (e.g. a
// depth-2 graph expansion on a hub node) so they can't hold a pooled connection
// indefinitely and starve the 50-connection pool.
const QUERY_TIMEOUT_MS = 15000

// Run a Cypher query in its own session, return plain JS objects
async function runQuery(cypher, params = {}, { timeout = QUERY_TIMEOUT_MS } = {}) {
  const session = driver.session()
  try {
    const result = await Sentry.startSpan(
      { name: 'neo4j.query', op: 'db.query', attributes: { 'db.system': 'neo4j' } },
      async () => session.run(cypher, params, { timeout })
    )
    return result.records.map(r => {
      const obj = {}
      r.keys.forEach(key => {
        obj[key] = toJs(r.get(key))
      })
      return obj
    })
  } finally {
    await session.close()
  }
}

// Shorthand: company match clause
const WHERE_CO = 'WHERE c.lei = $id OR c.wikidata_id = $id'

// ---------------------------------------------------------------------------
// Enrichment trust filter (audit 2026-08-29, finding C2).
//
// The ETL matches public records (EPA violations, consumer complaints,
// government contracts, recalls, lobbying, ...) to companies by BARE NAME, so
// colliding names misattribute records to the wrong company — a Swiss ministry
// carrying US EPA violations, one contract bound to 73 companies, etc. Until
// the pipeline is re-keyed on verified identity (LEI/QID), we filter low-trust
// edges at READ TIME so users never see the misattributed records. This is a
// pure read filter — reversible by removing it; it deletes no data.
//
// Two layers:
//  1. Per-edge trust predicate (below): keep an edge only if it wasn't matched
//     by bare name, OR is high-confidence, OR is corroborated, OR the record's
//     own company_name matches this node AND the record isn't fanned out to
//     multiple companies. Catches the name-mismatch + fan-out classes.
//  2. Static quarantine list: non-corporate / foreign top holders whose own
//     record name DOES match (so the predicate can't catch them) but which
//     cannot legitimately hold US public records. Drop ids as the graph is
//     cleaned; verified legitimate high-volume holders (e.g. CVS Pharmacy) are
//     deliberately excluded.
const QUARANTINED_ENRICHMENT_IDS = [
  'Q30262334', // "Environment, City, Society" — non-company node (14,984 EPA)
  'Q678661', // Swiss Federal Dept of Environment/Transport/Energy (7,606 EPA)
  '549300L1QYAKFHSIGE94', // City of Mesa, AZ (1,398 EPA)
  '3157000IKFELACJPBT77', // NORTH-LINE, a.s. (CZ)
  '315700PIEKIJSCP2IN95', // 4-les (CZ)
  '529900B91AUH0YTEXN10', // National-Bank (DE)
  'Q4762258', // "Angel" — single-word name match
  '315700NDGUEHD8SCGO17', // FORT-KM (CZ)
  '315700TRJOWN0AGIMB73', // 1 Energy (CZ)
  '3157001P04SVZ4KM0Q89', // BLOCK (CZ)
  '9598006DQSU4NU073U58', // BODEGAS RIOJANAS, S.A. (ES)
  '315700BJM7Q3GUFEBW46', // FERMATA, a.s. (CZ)
  '315700XBS0U0D8407N58', // Amundi CR fund (CZ)
  '315700IBAJV4415GQA69', // BLANÁŘ NÁBYTEK, a.s. (CZ)
  '097900BGKM0000053160', // Národný centrálny depozitár cenných papierov (SK)
  '315700OL0QAUR7YSWP74', // Zas Zbizuby, a.s. (CZ)
]

// Per-edge trust WHERE clause. `rel`/`node` are the bound variable names, `c`
// is the company (always in scope). COUNT{} requires Neo4j 5 (AuraDB is 5.x).
const enrichTrust = (rel, node, relType) =>
  `coalesce(${rel}.disputed, false) = false
     AND NOT coalesce(c.lei, c.wikidata_id) IN $qids
     AND ( coalesce(${rel}.matched_by, 'company_name_exact') <> 'company_name_exact'
        OR coalesce(${rel}.match_confidence, '') = 'high'
        OR size(coalesce(${rel}.corroborated_by, [])) > 0
        OR ( toLower(replace(coalesce(${node}.company_name, ''), '"', '')) = toLower(replace(c.name, '"', ''))
             AND COUNT { (${node})<-[:${relType}]-(:Company) } = 1 ) )`

// Enrichment relationship specs — one filtered subquery is generated per spec.
const ENRICHMENT_SPECS = [
  {
    rel: 'PENALIZED_FOR',
    node: 'v',
    label: 'Violation',
    alias: 'violations',
    order: 'v.year DESC',
    cap: 200,
  },
  {
    rel: 'HAS_EPA_VIOLATION',
    node: 'ev',
    label: 'EnvironmentalViolation',
    alias: 'envViolations',
    order: null,
    cap: 200,
  },
  {
    rel: 'HAS_ESG_SCORE',
    node: 'e',
    label: 'ESGScore',
    alias: 'esgScores',
    order: 'e.year DESC',
    cap: 200,
  },
  { rel: 'PRODUCES_AT', node: 'f', label: 'Facility', alias: 'facilities', order: null, cap: 200 },
  {
    rel: 'RECEIVED_SUBSIDY',
    node: 's',
    label: 'Subsidy',
    alias: 'subsidies',
    order: 's.year DESC',
    cap: 200,
  },
  {
    rel: 'LOBBIED_FOR',
    node: 'l',
    label: 'LobbyingRecord',
    alias: 'lobbying',
    order: 'l.year DESC',
    cap: 200,
  },
  {
    rel: 'RECALLED_PRODUCT',
    node: 'rc',
    label: 'Recall',
    alias: 'recalls',
    order: 'rc.date DESC',
    cap: 200,
  },
  {
    rel: 'HAS_COMPLAINT',
    node: 'cc',
    label: 'ConsumerComplaint',
    alias: 'complaints',
    order: 'cc.date_received DESC',
    cap: 500,
  },
  {
    rel: 'AWARDED_CONTRACT',
    node: 'gc',
    label: 'GovernmentContract',
    alias: 'contracts',
    order: 'gc.amount DESC',
    cap: 200,
  },
  {
    rel: 'LINKED_TO_OFFSHORE',
    node: 'oe',
    label: 'OffshoreEntity',
    alias: 'offshore',
    order: null,
    cap: 200,
  },
]

// Builds the enrichment Cypher: a trust-filtered collect + kept count per spec,
// plus one subquery returning the unfiltered totals so the UI can show
// "N verified · M hidden".
function buildEnrichmentQuery() {
  const blocks = ENRICHMENT_SPECS.map(s => {
    const withClause = s.order ? `WITH ${s.node}, r ORDER BY ${s.order}` : `WITH ${s.node}, r`
    // LIMIT before collect: collecting every row and slicing afterwards ran
    // the database out of memory on companies with tens of thousands of
    // records (Equifax has 71,000 complaints).
    return `CALL { WITH c
           MATCH (c)-[r:${s.rel}]->(${s.node}:${s.label})
           WHERE ${enrichTrust('r', s.node, s.rel)}
           ${withClause}
           LIMIT ${s.cap}
           RETURN collect(${s.node} { .*, matched_by: r.matched_by, match_confidence: r.match_confidence, confidence: r.confidence }) AS ${s.alias}
         }
         CALL { WITH c
           MATCH (c)-[r:${s.rel}]->(${s.node}:${s.label})
           WHERE ${enrichTrust('r', s.node, s.rel)}
           RETURN count(${s.node}) AS ${s.alias}Kept
         }`
  }).join('\n         ')
  const totals = `CALL { WITH c RETURN ${ENRICHMENT_SPECS.map(s => `COUNT { (c)-[:${s.rel}]->() } AS ${s.alias}Total`).join(', ')} }`
  const returns = ENRICHMENT_SPECS.flatMap(s => [
    s.alias,
    `${s.alias}Kept`,
    `${s.alias}Total`,
  ]).join(', ')
  return `MATCH (c:Company) ${WHERE_CO}\n         ${blocks}\n         ${totals}\n         RETURN ${returns}`
}
const ENRICHMENT_QUERY = buildEnrichmentQuery()

// Escape Lucene special characters to prevent query syntax injection
function escapeLucene(str) {
  return str.replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, '\\$&')
}

// Build a fuzzy Lucene query: each word gets prefix OR fuzzy matching
// "nestle" → "(nestle* OR nestle~1)", "apple inc" → "(apple* OR apple~1) (inc* OR inc~1)"
const STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'but',
  'in',
  'on',
  'at',
  'to',
  'for',
  'of',
  'with',
  'by',
  'from',
  'is',
  'it',
  'as',
  'be',
  'was',
  'are',
  'been',
  'has',
  'have',
  'had',
  'do',
  'does',
  'did',
  'will',
  'would',
  'not',
  'no',
  'so',
  'if',
  'its',
  'inc',
  'llc',
  'ltd',
  'co',
  'corp',
])

function buildFuzzyQuery(raw) {
  if (typeof raw !== 'string') return '' // array-valued ?q= params etc.
  const tokens = raw
    .replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, ' ') // strip special chars
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  const words = tokens.filter(w => w.length >= 2).filter(w => !STOPWORDS.has(w.toLowerCase()))
  if (words.length > 0) return words.map(w => `(${w}* OR ${w}~1)`).join(' AND ')
  // Names built from initials ("H&M", "AT&T", "P&G") lose every token above.
  // Match their terms exactly instead; a lone stopword still returns nothing.
  if (!tokens.some(w => w.length === 1)) return ''
  const terms = tokens.filter(w => /^[\p{L}\p{N}']+$/u.test(w))
  return terms.map(w => `"${w}"`).join(' AND ')
}

// In-memory cache for expensive queries
const apiCache = new NodeCache({ stdTTL: 300, checkperiod: 60, maxKeys: 2000 })

// node-cache throws ECACHEFULL once maxKeys is hit. Since every cache write
// sits inside a route try-block, an unguarded throw turns a successful Neo4j
// query into a 500. Swallow the failure so the response still ships uncached.
function safeSet(key, val, ttl) {
  try {
    return ttl !== undefined ? apiCache.set(key, val, ttl) : apiCache.set(key, val)
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
app.get('/api/health', async (req, res) => {
  // Short-TTL cache so the rate-limit-exempt health route can't be used to
  // hammer Neo4j — probe floods cost at most one DB round-trip per 5s.
  const cachedHealth = apiCache.get('health')
  if (cachedHealth) return res.json(cachedHealth)
  try {
    const start = Date.now()
    await runQuery('RETURN 1')
    const queryMs = Date.now() - start
    const mem = process.memoryUsage()

    const payload = {
      status: 'ok',
      neo4j: 'connected',
      query_ms: queryMs,
      memory_mb: Math.round(mem.heapUsed / 1024 / 1024),
      memory_max_mb: Math.round(mem.heapTotal / 1024 / 1024),
      uptime_s: Math.round(process.uptime()),
      cache_keys: apiCache.keys().length,
      cache_max: 2000,
    }
    safeSet('health', payload, 5)
    res.json(payload)
  } catch {
    res.status(500).json({ status: 'error', message: 'Health check failed' })
  }
})

// ---------------------------------------------------------------------------
// Search companies (full-text index)
// ---------------------------------------------------------------------------
app.get('/api/companies/search', async (req, res) => {
  const { q, limit = 20 } = req.query

  if (!q || q.length < 2) return res.json([])
  if (q.length > 200) return res.status(400).json({ error: 'Query too long' })

  const safeLimit = Math.max(1, Math.min(parseInt(limit) || 20, 100))
  const searchCacheKey = `search:company:${q}:${safeLimit}`
  const searchCached = apiCache.get(searchCacheKey)
  if (searchCached) return res.json(searchCached)

  try {
    const fuzzyQuery = buildFuzzyQuery(q)
    if (!fuzzyQuery) return res.json([])

    const records = await runQuery(
      `CALL db.index.fulltext.queryNodes('company_fulltext', $query)
       YIELD node AS c, score
       // Universities, cities and other LEI holders that Wikidata does not
       // type as a business stay reachable by link but not by search.
       WHERE NOT coalesce(c.non_business, false)
       WITH c, score,
            // Composite significance score
            score * 2.0
            + CASE WHEN c.revenue IS NOT NULL THEN log10(toFloat(c.revenue) + 1) / 3.0 ELSE 0 END
            + CASE WHEN c.employees IS NOT NULL THEN log10(toFloat(c.employees) + 1) ELSE 0 END
            + coalesce(c.subsidiary_count, 0) * 0.3
            + coalesce(c.brand_count, 0) * 0.3
            + CASE WHEN c.logo_url IS NOT NULL THEN 1.0 ELSE 0 END
            + CASE WHEN c.stock_exchange IS NOT NULL THEN 1.5 ELSE 0 END
            + coalesce(c.source_count, 0) * 0.2
            AS rank
       RETURN coalesce(c.lei, c.wikidata_id) AS id,
              c.name AS name, c.logo_url AS logo_url,
              c.website AS website, c.description AS description,
              c.lei AS lei, c.ticker AS ticker, c.country AS country,
              c.wikidata_id AS wikidata_id, c.industry AS industry,
              c.employees AS employees, c.sanctioned AS sanctioned,
              c.sanction_lists AS sanction_lists, c.sanction_programs AS sanction_programs,
              c.brand_count AS brand_count,
              c.subsidiary_count AS subsidiary_count
       ORDER BY rank DESC
       LIMIT toInteger($limit)`,
      { query: fuzzyQuery, limit: safeLimit }
    )
    safeSet(searchCacheKey, records, 600) // 10 min TTL for search
    res.json(records)
  } catch (err) {
    console.error('Search error:', err)
    res.status(500).json({ error: 'Search failed' })
  }
})

// ---------------------------------------------------------------------------
// Get company by ID — surfaces ALL ETL data
// ---------------------------------------------------------------------------
app.get('/api/companies/:id', async (req, res) => {
  const { id } = req.params
  const cacheKey = `company:${id}`
  const cached = apiCache.get(cacheKey)
  if (cached) return res.json(cached)

  try {
    // Two batched queries instead of 17 individual ones (2 sessions vs 17)
    const [connRows, enrichRows] = await Promise.all([
      // Query 1: Company node + all connections
      runQuery(
        `MATCH (c:Company) ${WHERE_CO}
         WITH c, properties(c) AS props
         CALL { WITH c
           MATCH (child:Company)-[r:SUBSIDIARY_OF]->(c)
           RETURN collect({id: coalesce(child.lei, child.wikidata_id), name: child.name,
             logo_url: child.logo_url, source: r.source, confidence: r.confidence,
             corroborated_by: r.corroborated_by, last_confirmed: r.last_confirmed,
             gleif_relationship_type: r.gleif_relationship_type,
             source_url: r.source_url, wikidata_id: child.wikidata_id, lei: child.lei})[..200] AS owns
         }
         CALL { WITH c
           MATCH (c)-[r:SUBSIDIARY_OF]->(parent:Company)
           RETURN collect({id: coalesce(parent.lei, parent.wikidata_id), name: parent.name,
             logo_url: parent.logo_url, source: r.source, confidence: r.confidence,
             corroborated_by: r.corroborated_by, last_confirmed: r.last_confirmed,
             source_url: r.source_url, wikidata_id: parent.wikidata_id, lei: parent.lei})[..200] AS ownedBy
         }
         CALL { WITH c
           MATCH (c)-[r:INVESTED_IN_BY]->(investor:Company)
           RETURN collect({id: coalesce(investor.lei, investor.wikidata_id), name: investor.name,
             logo_url: investor.logo_url, source: r.source, confidence: r.confidence,
             ownership_percentage: r.ownership_percentage,
             last_confirmed: r.last_confirmed,
             source_url: r.source_url, wikidata_id: investor.wikidata_id, lei: investor.lei})[..200] AS investedInBy
         }
         CALL { WITH c
           MATCH (investee:Company)-[r:INVESTED_IN_BY]->(c)
           RETURN collect({id: coalesce(investee.lei, investee.wikidata_id), name: investee.name,
             logo_url: investee.logo_url, source: r.source, confidence: r.confidence,
             ownership_percentage: r.ownership_percentage,
             last_confirmed: r.last_confirmed,
             source_url: r.source_url, wikidata_id: investee.wikidata_id, lei: investee.lei})[..200] AS investsIn
         }
         CALL { WITH c
           MATCH (c)<-[r:SUPPLIES]-(supplier:Company)
           RETURN collect({id: coalesce(supplier.lei, supplier.wikidata_id), name: supplier.name,
             logo_url: supplier.logo_url, source: r.source, confidence: r.confidence,
             sec_filing: r.sec_filing, last_confirmed: r.last_confirmed,
             source_url: r.source_url, wikidata_id: supplier.wikidata_id, lei: supplier.lei})[..200] AS suppliers
         }
         CALL { WITH c
           MATCH (c)-[r:SUPPLIES]->(customer:Company)
           RETURN collect({id: coalesce(customer.lei, customer.wikidata_id), name: customer.name,
             logo_url: customer.logo_url, source: r.source, confidence: r.confidence,
             sec_filing: r.sec_filing, last_confirmed: r.last_confirmed,
             source_url: r.source_url, wikidata_id: customer.wikidata_id, lei: customer.lei})[..200] AS customers
         }
         CALL { WITH c
           MATCH (brand:Brand)-[r:OWNED_BY]->(c)
           RETURN collect({id: brand.wikidata_id, name: brand.name, logo_url: brand.logo_url,
             source: r.source, confidence: r.confidence,
             last_confirmed: r.last_confirmed,
             source_url: r.source_url})[..200] AS brands
         }
         CALL { WITH c
           MATCH (p:Person)-[r]->(c)
             WHERE type(r) IN ['CEO_OF', 'FOUNDED', 'BOARD_MEMBER_OF', 'COMPENSATED_BY', 'SIGNIFICANT_CONTROL']
           RETURN collect({id: p.wikidata_id, name: p.name, role: type(r), rel: properties(r),
             total_compensation: p.total_compensation, base_salary: p.base_salary,
             stock_awards: p.stock_awards, comp_fiscal_year: p.comp_fiscal_year,
             nationality: p.nationality, country_of_residence: p.country_of_residence})[..200] AS people
         }
         CALL { WITH c
           MATCH (c)-[r:DONATED_TO|DONATED_TO_STATE]->(pol:Politician)
           // Disputed: FEC individual contributions keyed on the donor's
           // employer, i.e. employees' personal donations, not the company's.
           WHERE NOT coalesce(r.disputed, false)
           WITH pol, r, type(r) AS dtype ORDER BY r.amount DESC
           RETURN collect({id: pol.fec_id, name: pol.name, party: pol.party, state: pol.state,
             office: pol.office, donation_type: dtype, amount: r.amount, year: r.year,
             source: r.source, source_url: r.source_url})[..200] AS donations
         }
         RETURN props, owns, ownedBy, investedInBy, investsIn, suppliers, customers, brands, people, donations`,
        { id }
      ),
      // Query 2: All enrichment data, trust-filtered (see enrichTrust / C2).
      runQuery(ENRICHMENT_QUERY, { id, qids: QUARANTINED_ENRICHMENT_IDS }),
    ])

    if (connRows.length === 0) {
      return res.status(404).json({ error: 'Company not found' })
    }

    const c = connRows[0]
    const e = enrichRows[0] || {}

    const companyData = {
      ...c.props,
      id: c.props.lei || c.props.wikidata_id,
    }

    companyData.connections = {
      owns: (c.owns || []).filter(r => r.id),
      owned_by: (c.ownedBy || []).filter(r => r.id),
      invested_in_by: (c.investedInBy || []).filter(r => r.id),
      invests_in: (c.investsIn || []).filter(r => r.id),
      suppliers: (c.suppliers || []).filter(r => r.id),
      customers: (c.customers || []).filter(r => r.id),
      brands: (c.brands || []).filter(r => r.id),
      people: (c.people || []).map(p => ({ ...p, rel: p.rel || {} })),
      political_donations: c.donations || [],
    }

    companyData.violations = e.violations || []
    companyData.environmental_violations = e.envViolations || []
    companyData.esg_scores = e.esgScores || []
    companyData.facilities = e.facilities || []
    companyData.subsidies = e.subsidies || []
    companyData.lobbying = e.lobbying || []
    companyData.recalls = e.recalls || []
    companyData.consumer_complaints = e.complaints || []
    companyData.government_contracts = e.contracts || []
    companyData.offshore_entities = e.offshore || []

    // Verified-vs-total counts per enrichment type, so the UI can show
    // "N verified · M hidden pending identity verification" instead of
    // silently dropping the misattributed records (audit C2).
    companyData.enrichment_meta = ENRICHMENT_SPECS.reduce((acc, s) => {
      const kept = e[`${s.alias}Kept`] || 0
      const total = e[`${s.alias}Total`] || 0
      if (total > kept) acc[s.alias] = { kept, total, hidden: total - kept }
      return acc
    }, {})

    safeSet(cacheKey, companyData)
    res.json(companyData)
  } catch (err) {
    console.error('Get company error:', err)
    res.status(500).json({ error: 'Failed to fetch company' })
  }
})

// ---------------------------------------------------------------------------
// Company graph — { nodes, links } at the requested depth (1 or 2)
// Used by the iOS app's CompanyDetailView graph rendering.
// ---------------------------------------------------------------------------
app.get('/api/companies/:id/graph', async (req, res) => {
  const { id } = req.params
  const depth = Math.min(2, Math.max(1, parseInt(req.query.depth, 10) || 1))
  const cacheKey = `company:${id}:graph:d${depth}`
  const cached = apiCache.get(cacheKey)
  if (cached) return res.json(cached)

  try {
    const rows = await runQuery(
      `MATCH (c:Company) ${WHERE_CO}
       CALL { WITH c
         MATCH path = (c)-[*1..${depth}]-(n)
         WHERE ALL(x IN nodes(path) WHERE x:Company OR x:Brand OR x:Person)
         WITH nodes(path) AS ns, relationships(path) AS rs
         UNWIND ns AS node UNWIND rs AS rel
         RETURN collect(DISTINCT node) AS nodes, collect(DISTINCT rel) AS rels
       }
       RETURN
         coalesce(c.lei, c.wikidata_id) AS center_id,
         c.name AS center_name,
         [n IN nodes |
           {id: coalesce(n.lei, n.wikidata_id, toString(elementId(n))),
            name: coalesce(n.name, ''),
            type: head(labels(n))}] AS nodes,
         [r IN rels |
           {source: coalesce(startNode(r).lei, startNode(r).wikidata_id, toString(elementId(startNode(r)))),
            target: coalesce(endNode(r).lei, endNode(r).wikidata_id, toString(elementId(endNode(r)))),
            type: type(r)}] AS links`,
      { id }
    )

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Company not found' })
    }

    const row = rows[0]
    const seen = new Set()
    const nodes = []
    for (const n of row.nodes || []) {
      if (n && n.id && !seen.has(n.id)) {
        seen.add(n.id)
        nodes.push(n)
      }
    }

    const linkSeen = new Set()
    const links = []
    for (const l of row.links || []) {
      if (!l || !l.source || !l.target) continue
      const k = `${l.source}|${l.target}|${l.type}`
      if (linkSeen.has(k)) continue
      linkSeen.add(k)
      links.push(l)
    }

    const payload = { nodes, links }
    safeSet(cacheKey, payload)
    res.json(payload)
  } catch (err) {
    console.error('Get company graph error:', err)
    res.status(500).json({ error: 'Failed to fetch company graph' })
  }
})

// ---------------------------------------------------------------------------
// Search brands (full-text index) — MUST be before /api/brands/:id
// ---------------------------------------------------------------------------
app.get('/api/brands/search', async (req, res) => {
  const { q, limit = 20 } = req.query

  if (!q || q.length < 2) return res.json([])
  if (q.length > 200) return res.status(400).json({ error: 'Query too long' })

  const safeLimit = Math.max(1, Math.min(parseInt(limit) || 20, 100))
  const brandSearchKey = `search:brand:${q}:${safeLimit}`
  const brandSearchCached = apiCache.get(brandSearchKey)
  if (brandSearchCached) return res.json(brandSearchCached)

  try {
    const fuzzyQuery = buildFuzzyQuery(q)
    if (!fuzzyQuery) return res.json([]) // all-stopword query → empty, not a 500
    const rows = await runQuery(
      `CALL db.index.fulltext.queryNodes('brand_fulltext', $query)
       YIELD node AS b, score
       OPTIONAL MATCH (b)-[:OWNED_BY]->(c:Company)
       RETURN b.wikidata_id AS id, b.name AS name, b.logo_url AS logo_url,
              coalesce(c.lei, c.wikidata_id) AS company_id, c.name AS company_name
       ORDER BY score DESC
       LIMIT toInteger($limit)`,
      { query: fuzzyQuery, limit: safeLimit }
    )

    const result = rows.map(r => ({
      id: r.id,
      name: r.name,
      logo_url: r.logo_url,
      company: r.company_id ? { id: r.company_id, name: r.company_name } : null,
    }))
    safeSet(brandSearchKey, result, 600)
    res.json(result)
  } catch (err) {
    console.error('Brand search error:', err)
    res.status(500).json({ error: 'Search failed' })
  }
})

// ---------------------------------------------------------------------------
// Search products by name (full-text index)
// ---------------------------------------------------------------------------
app.get('/api/products/search', async (req, res) => {
  const { q, limit = 20 } = req.query

  if (!q || q.length < 2) return res.json([])
  if (q.length > 200) return res.status(400).json({ error: 'Query too long' })

  const safeLimit = Math.max(1, Math.min(parseInt(limit) || 20, 100))
  const prodSearchKey = `search:product:${q}:${safeLimit}`
  const prodSearchCached = apiCache.get(prodSearchKey)
  if (prodSearchCached) return res.json(prodSearchCached)

  try {
    const fuzzyQuery = buildFuzzyQuery(q)
    if (!fuzzyQuery) return res.json([]) // all-stopword query → empty, not a 500
    const rows = await runQuery(
      `CALL db.index.fulltext.queryNodes('product_fulltext', $query)
       YIELD node AS p, score
       WHERE p.barcode IS NOT NULL
       OPTIONAL MATCH (p)<-[:SELLS]-(b:Brand)
       OPTIONAL MATCH (b)-[:OWNED_BY]->(c:Company)
       WITH p, score, collect(DISTINCT b.name)[0] AS brand,
            collect(DISTINCT c.name)[0] AS company_name,
            collect(DISTINCT coalesce(c.lei, c.wikidata_id))[0] AS company_id
       ORDER BY score DESC, brand IS NOT NULL DESC
       RETURN p.barcode AS barcode, p.name AS name, p.category AS category,
              p.image_url AS image_url, p.brand_name AS brand_name,
              brand, company_id, company_name
       LIMIT toInteger($limit)`,
      { query: fuzzyQuery, limit: safeLimit }
    )

    const result = rows.map(r => ({
      barcode: r.barcode,
      name: r.name,
      category: r.category,
      image_url: r.image_url,
      brand_name: r.brand_name || r.brand,
      company_id: r.company_id,
      company_name: r.company_name,
    }))
    safeSet(prodSearchKey, result, 600)
    res.json(result)
  } catch (err) {
    console.error('Product search error:', err)
    res.status(500).json({ error: 'Search failed' })
  }
})

// ---------------------------------------------------------------------------
// Get product by barcode
// ---------------------------------------------------------------------------
app.get('/api/products/barcode/:barcode', async (req, res) => {
  const { barcode } = req.params

  try {
    const rows = await runQuery(
      `MATCH (p:Product)
       WHERE p.barcode = $barcode OR p.upc = $barcode
       OPTIONAL MATCH (p)<-[:SELLS]-(b:Brand)
       OPTIONAL MATCH (b)-[:OWNED_BY]->(c:Company)
       RETURN p.barcode AS barcode, p.name AS name, p.category AS category,
              p.image_url AS image_url, p.brand_name AS brand_name,
              p.recalled AS recalled, p.recall_reason AS recall_reason,
              b.name AS brand, b.wikidata_id AS brand_id,
              coalesce(c.lei, c.wikidata_id) AS company_id,
              c.name AS company_name, c.logo_url AS company_logo
       LIMIT 1`,
      { barcode }
    )

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' })
    }

    const r = rows[0]
    res.json({
      barcode: r.barcode,
      name: r.name,
      category: r.category,
      image_url: r.image_url,
      brand_name: r.brand_name || r.brand,
      brand_id: r.brand_id,
      recalled: r.recalled,
      recall_reason: r.recall_reason,
      company_id: r.company_id,
      company_name: r.company_name,
      company_logo: r.company_logo,
    })
  } catch (err) {
    console.error('Barcode lookup error:', err)
    res.status(500).json({ error: 'Lookup failed' })
  }
})

// ---------------------------------------------------------------------------
// Get brand by ID — AFTER /search to avoid :id matching "search"
// ---------------------------------------------------------------------------
app.get('/api/brands/:id', async (req, res) => {
  const { id } = req.params
  const brandCacheKey = `brand:${id}`
  const cached = apiCache.get(brandCacheKey)
  if (cached) return res.json(cached)

  try {
    const rows = await runQuery(
      `MATCH (b:Brand) WHERE b.wikidata_id = $id
       OPTIONAL MATCH (b)-[r:OWNED_BY]->(c:Company)
       OPTIONAL MATCH (b)-[:SELLS]->(p:Product)
       RETURN properties(b) AS brand,
              coalesce(c.lei, c.wikidata_id) AS company_id,
              c.name AS company_name, c.logo_url AS company_logo,
              r.source AS ownership_source, r.confidence AS ownership_confidence, r.source_url AS ownership_source_url,
              c.wikidata_id AS company_wikidata_id, c.lei AS company_lei,
              collect(DISTINCT {barcode: p.barcode, name: p.name, category: p.category, image_url: p.image_url})[..50] AS products`,
      { id }
    )

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Brand not found' })
    }

    const r = rows[0]
    const brandData = {
      ...r.brand,
      id: r.brand.wikidata_id,
      company: r.company_id
        ? {
            id: r.company_id,
            name: r.company_name,
            logo_url: r.company_logo,
            source: r.ownership_source,
            confidence: r.ownership_confidence,
            source_url: r.ownership_source_url,
            wikidata_id: r.company_wikidata_id,
            lei: r.company_lei,
          }
        : null,
      products: (r.products || []).filter(p => p.barcode),
    }
    safeSet(brandCacheKey, brandData)
    res.json(brandData)
  } catch (err) {
    console.error('Get brand error:', err)
    res.status(500).json({ error: 'Failed to fetch brand' })
  }
})

// ---------------------------------------------------------------------------
// Get product by barcode — AFTER /search to avoid :barcode matching "search"
// ---------------------------------------------------------------------------
app.get('/api/products/:barcode', async (req, res) => {
  const { barcode } = req.params

  try {
    const rows = await runQuery(
      `MATCH (p:Product) WHERE p.barcode = $barcode
       OPTIONAL MATCH (p)<-[:SELLS]-(b:Brand)
       OPTIONAL MATCH (b)-[:OWNED_BY]->(c:Company)
       RETURN properties(p) AS product,
              b.wikidata_id AS brand_id, b.name AS brand_name, b.logo_url AS brand_logo,
              coalesce(c.lei, c.wikidata_id) AS company_id,
              c.name AS company_name, c.logo_url AS company_logo`,
      { barcode }
    )

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' })
    }

    const r = rows[0]
    res.json({
      ...r.product,
      brand: r.brand_id ? { id: r.brand_id, name: r.brand_name, logo_url: r.brand_logo } : null,
      company: r.company_id
        ? { id: r.company_id, name: r.company_name, logo_url: r.company_logo }
        : null,
    })
  } catch (err) {
    console.error('Get product error:', err)
    res.status(500).json({ error: 'Failed to fetch product' })
  }
})

// ---------------------------------------------------------------------------
// Get person by ID
// ---------------------------------------------------------------------------
app.get('/api/persons/:id', async (req, res) => {
  const { id } = req.params
  const personCacheKey = `person:${id}`
  const personCached = apiCache.get(personCacheKey)
  if (personCached) return res.json(personCached)

  try {
    const rows = await runQuery(
      `MATCH (p:Person) WHERE p.wikidata_id = $id
       OPTIONAL MATCH (p)-[r]->(c:Company)
         WHERE type(r) IN ['CEO_OF', 'FOUNDED', 'BOARD_MEMBER_OF', 'COMPENSATED_BY', 'SIGNIFICANT_CONTROL']
       RETURN properties(p) AS person,
              collect(DISTINCT {
                id: coalesce(c.lei, c.wikidata_id),
                name: c.name, logo_url: c.logo_url,
                role: type(r)
              }) AS companies`,
      { id }
    )

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Person not found' })
    }

    const r = rows[0]
    const personData = {
      ...r.person,
      id: r.person.wikidata_id,
      companies: (r.companies || []).filter(c => c.id),
    }
    safeSet(personCacheKey, personData)
    res.json(personData)
  } catch (err) {
    console.error('Get person error:', err)
    res.status(500).json({ error: 'Failed to fetch person' })
  }
})

// ---------------------------------------------------------------------------
// Database stats (cached 1 hour)
// ---------------------------------------------------------------------------
app.get('/api/stats', async (req, res) => {
  try {
    const cached = apiCache.get('stats')
    if (cached) return res.json(cached)

    const rows = await runQuery(
      `CALL {
         MATCH (c:Company) RETURN 'Company' AS label, count(c) AS count
         UNION ALL
         MATCH (b:Brand) RETURN 'Brand' AS label, count(b) AS count
         UNION ALL
         MATCH (p:Product) RETURN 'Product' AS label, count(p) AS count
         UNION ALL
         MATCH (p:Person) RETURN 'Person' AS label, count(p) AS count
         UNION ALL
         MATCH (p:Politician) RETURN 'Politician' AS label, count(p) AS count
       }
       RETURN label, count
       ORDER BY count DESC`
    )

    const stats = {}
    rows.forEach(r => {
      stats[r.label] = r.count
    })

    safeSet('stats', stats, 3600) // 1 hour TTL
    res.json(stats)
  } catch (err) {
    console.error('Stats error:', err)
    res.status(500).json({ error: 'Failed to fetch stats' })
  }
})

Sentry.setupExpressErrorHandler(app)

// ---------------------------------------------------------------------------
// 404 catch-all for undefined API routes
// ---------------------------------------------------------------------------
app.use('/api/', (req, res) => {
  res.status(404).json({ error: 'Not found' })
})

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
async function shutdown() {
  console.log('Shutting down...')
  await driver.close()
  process.exit(0)
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

app.listen(PORT, () => {
  console.log(`Boyk Neo4j API running on port ${PORT}`)
  console.log(`Neo4j: ${NEO4J_URI}`)
})
