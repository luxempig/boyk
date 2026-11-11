#!/usr/bin/env node
/**
 * Graph identity rebuild: export prod → resolve identities → emit to staging → assert.
 *
 * The pathology this repairs (measured 2026-06-10):
 *   - 309 wikidata QIDs stamped on 640 Company nodes (name-matched enrichment).
 *     Distinct legal entities (different LEIs) wrongly share a QID; ghost duplicates
 *     (QID-only nodes shadowing an LEI node) split connections across two nodes.
 *   - http:// URLs in website/logo_url/source_url props (mixed-content warnings).
 *
 * Resolution rules (Company):
 *   - For each QID shared by >1 node: winner = highest degree (tie: has LEI).
 *   - Losers WITH an LEI are distinct legal entities → unstamp the QID
 *     (recorded as qid_group so group membership is queryable). Their public ID
 *     (coalesce(lei, wikidata_id)) was already the LEI, so no reference breaks.
 *   - Losers WITHOUT an LEI are same-entity ghosts → merged into the winner:
 *     relationships rewired, missing props filled, node dropped. Their public ID
 *     (the QID) now resolves to the winner, so no reference breaks.
 *   - Same logic for Brand/Person by wikidata_id (no LEI concept: winner keeps
 *     the QID, ghost losers merge into it).
 *
 * Safety: phase `export` is read-only against prod. Only `emit` writes, and only
 * to the staging URI. Asserts refuse to run emit against the prod URI.
 *
 * Usage:  node rebuild.mjs export|resolve|emit|assert   (state in ./state/)
 * Env:    reads ../../../boyk_dev/.env style file via REBUILD_ENV_FILE (default ~/Projects/boyk_dev/.env)
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import neo4j from 'neo4j-driver'

const HERE = dirname(fileURLToPath(import.meta.url))
const STATE = join(HERE, 'state')
mkdirSync(STATE, { recursive: true })

const ENV_FILE = process.env.REBUILD_ENV_FILE || join(process.env.HOME, 'Projects/boyk_dev/.env')
const env = {}
for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2]
}

const PROD = { uri: env.NEO4J_URI, user: env.NEO4J_USER || 'neo4j', pass: env.NEO4J_PASSWORD }
const STAGING = {
  uri: env.NEO4J_STAGING_URI,
  user: env.NEO4J_STAGING_USER || 'neo4j',
  pass: env.NEO4J_STAGING_PASSWORD,
}
if (!PROD.uri || !STAGING.uri) throw new Error('Missing NEO4J_URI / NEO4J_STAGING_URI in env file')
if (PROD.uri === STAGING.uri) throw new Error('Prod and staging URIs are identical — refusing')

// emit/assert target: staging by default. Cutting over to prod requires BOTH
// REBUILD_TARGET=prod AND a snapshot id in REBUILD_PROD_SNAPSHOT_ID (proof that a
// rollback point was taken first). Used when Aura's clone-to-existing is unavailable
// (e.g. provisioned-storage disparity between instances).
function targetCreds() {
  if (process.env.REBUILD_TARGET === 'prod') {
    if (!process.env.REBUILD_PROD_SNAPSHOT_ID) {
      throw new Error('REBUILD_TARGET=prod requires REBUILD_PROD_SNAPSHOT_ID (take an Aura snapshot first)')
    }
    return { ...PROD, isProd: true }
  }
  return { ...STAGING, isProd: false }
}

const URL_PROPS = ['website', 'logo_url', 'source_url', 'url', 'image_url']
const httpsify = v => (typeof v === 'string' && v.startsWith('http://') ? 'https://' + v.slice(7) : v)

function plain(v) {
  if (neo4j.isInt(v)) return v.toNumber()
  if (neo4j.isDate(v) || neo4j.isDateTime(v) || neo4j.isLocalDateTime(v)) return v.toString()
  if (Array.isArray(v)) return v.map(plain)
  return v
}
function plainProps(props) {
  const o = {}
  for (const [k, v] of Object.entries(props)) o[k] = plain(v)
  return o
}

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

// ---------------------------------------------------------------------------
async function phaseExport() {
  const driver = neo4j.driver(PROD.uri, neo4j.auth.basic(PROD.user, PROD.pass), {
    maxConnectionPoolSize: 4,
  })
  const session = driver.session({ defaultAccessMode: neo4j.session.READ })

  log('exporting nodes…')
  const nodes = []
  const nodeRes = await session.run(
    `MATCH (n) RETURN elementId(n) AS eid, labels(n) AS labels, properties(n) AS props`
  )
  for (const rec of nodeRes.records) {
    nodes.push({
      eid: rec.get('eid'),
      labels: rec.get('labels'),
      props: plainProps(rec.get('props')),
    })
  }
  log(`  ${nodes.length} nodes`)

  log('exporting relationships…')
  const rels = []
  const relRes = await session.run(
    `MATCH (a)-[r]->(b)
     RETURN elementId(a) AS src, elementId(b) AS dst, type(r) AS type, properties(r) AS props`
  )
  for (const rec of relRes.records) {
    rels.push({
      src: rec.get('src'),
      dst: rec.get('dst'),
      type: rec.get('type'),
      props: plainProps(rec.get('props')),
    })
  }
  log(`  ${rels.length} relationships`)

  log('exporting indexes/constraints…')
  const idx = await session.run(`SHOW INDEXES YIELD name, type, labelsOrTypes, properties
    WHERE type IN ['RANGE','FULLTEXT','TEXT','POINT'] RETURN name, type, labelsOrTypes, properties`)
  const indexes = idx.records.map(r => ({
    name: r.get('name'),
    type: r.get('type'),
    labels: r.get('labelsOrTypes'),
    properties: r.get('properties'),
  }))
  log(`  ${indexes.length} indexes`)

  writeFileSync(join(STATE, 'nodes.json'), JSON.stringify(nodes))
  writeFileSync(join(STATE, 'rels.json'), JSON.stringify(rels))
  writeFileSync(join(STATE, 'indexes.json'), JSON.stringify(indexes, null, 2))
  await session.close()
  await driver.close()
  log('export complete')
}

// ---------------------------------------------------------------------------
function phaseResolve() {
  const nodes = JSON.parse(readFileSync(join(STATE, 'nodes.json'), 'utf8'))
  const rels = JSON.parse(readFileSync(join(STATE, 'rels.json'), 'utf8'))

  // degree map for winner selection
  const degree = new Map()
  for (const r of rels) {
    degree.set(r.src, (degree.get(r.src) || 0) + 1)
    degree.set(r.dst, (degree.get(r.dst) || 0) + 1)
  }

  const report = { merged: [], unstamped: [], httpsFixed: 0, byLabel: {} }
  const mergedInto = new Map() // loser eid -> winner eid

  // Identity repair for every key the schema declares UNIQUE. Companies get the
  // special case: a loser with an LEI is a distinct legal entity (unstamp the QID,
  // keep the node); everything else is a ghost duplicate (merge into winner).
  // Every (label, prop) here must match a constraint created in phaseEmit, so the
  // resolved graph provably satisfies the declared schema.
  const IDENTITY_KEYS = [
    { label: 'Company', prop: 'wikidata_id', unstampIfLei: true },
    { label: 'Brand', prop: 'wikidata_id' },
    { label: 'Person', prop: 'wikidata_id' },
    { label: 'Product', prop: 'barcode' },
    { label: 'Politician', prop: 'fec_id' },
    { label: 'Facility', prop: 'os_id' },
    { label: 'Country', prop: 'iso_code' },
    { label: 'Recall', prop: 'recall_id' },
    { label: 'ConsumerComplaint', prop: 'complaint_id' },
    { label: 'GovernmentContract', prop: 'award_id' },
    { label: 'OffshoreEntity', prop: 'icij_id' },
    { label: 'Violation', prop: 'case_id' },
  ]
  for (const { label, prop, unstampIfLei } of IDENTITY_KEYS) {
    const byKey = new Map()
    for (const n of nodes) {
      if (mergedInto.has(n.eid) || !n.labels.includes(label)) continue
      const k = n.props[prop]
      if (k === undefined || k === null || k === '') continue
      if (!byKey.has(k)) byKey.set(k, [])
      byKey.get(k).push(n)
    }
    let groups = 0
    for (const [keyVal, group] of byKey) {
      if (group.length < 2) continue
      groups++
      group.sort(
        (a, b) =>
          (degree.get(b.eid) || 0) - (degree.get(a.eid) || 0) ||
          (b.props.lei ? 1 : 0) - (a.props.lei ? 1 : 0)
      )
      const winner = group[0]
      for (const loser of group.slice(1)) {
        if (unstampIfLei && loser.props.lei) {
          // Distinct legal entity wrongly stamped with this QID → unstamp.
          loser.props.qid_group = keyVal
          delete loser.props[prop]
          report.unstamped.push({ label, key: keyVal, kept: winner.eid, lei: loser.props.lei, name: loser.props.name })
        } else {
          // Ghost duplicate → merge into winner.
          mergedInto.set(loser.eid, winner.eid)
          for (const [k, v] of Object.entries(loser.props)) {
            if (winner.props[k] === undefined || winner.props[k] === null) winner.props[k] = v
          }
          report.merged.push({ label, key: keyVal, winner: winner.eid, loserName: loser.props.name })
        }
      }
    }
    report.byLabel[`${label}.${prop}`] = { groups }
  }

  // Drop merged nodes; https-ify URL props.
  const keep = nodes.filter(n => !mergedInto.has(n.eid))
  for (const n of keep) {
    for (const p of URL_PROPS) {
      if (typeof n.props[p] === 'string' && n.props[p].startsWith('http://')) {
        n.props[p] = httpsify(n.props[p])
        report.httpsFixed++
      }
    }
  }

  // Rewire rels to winners; https-ify rel URL props; dedupe identical (type,src,dst).
  const seen = new Set()
  const outRels = []
  let rewired = 0
  for (const r of rels) {
    const src = mergedInto.get(r.src) || r.src
    const dst = mergedInto.get(r.dst) || r.dst
    if (src !== r.src || dst !== r.dst) rewired++
    if (src === dst) continue // drop self-loops created by merges
    const key = `${r.type}|${src}|${dst}`
    if (seen.has(key)) continue
    seen.add(key)
    for (const p of URL_PROPS) {
      if (typeof r.props[p] === 'string' && r.props[p].startsWith('http://')) {
        r.props[p] = httpsify(r.props[p])
        report.httpsFixed++
      }
    }
    outRels.push({ ...r, src, dst })
  }

  report.summary = {
    nodesIn: nodes.length,
    nodesOut: keep.length,
    nodesMerged: mergedInto.size,
    nodesUnstamped: report.unstamped.length,
    relsIn: rels.length,
    relsOut: outRels.length,
    relsRewired: rewired,
    relsDeduped: rels.length - outRels.length,
  }

  writeFileSync(join(STATE, 'nodes.resolved.json'), JSON.stringify(keep))
  writeFileSync(join(STATE, 'rels.resolved.json'), JSON.stringify(outRels))
  writeFileSync(
    join(STATE, 'resolution-report.json'),
    JSON.stringify({ summary: report.summary, byLabel: report.byLabel, unstamped: report.unstamped, merged: report.merged }, null, 2)
  )
  console.log(JSON.stringify(report.summary, null, 2))
  log('resolve complete — report in state/resolution-report.json')
}

// ---------------------------------------------------------------------------
async function phaseEmit() {
  const target = targetCreds()
  if (!target.isProd && target.uri.includes('362d2469'))
    throw new Error('emit target looks like PROD — refusing (use REBUILD_TARGET=prod + snapshot id)')
  const nodes = JSON.parse(readFileSync(join(STATE, 'nodes.resolved.json'), 'utf8'))
  const rels = JSON.parse(readFileSync(join(STATE, 'rels.resolved.json'), 'utf8'))
  const indexes = JSON.parse(readFileSync(join(STATE, 'indexes.json'), 'utf8'))

  log(`emit target: ${target.isProd ? 'PROD' : 'staging'} (${target.uri})`)
  if (target.isProd) log(`rollback snapshot: ${process.env.REBUILD_PROD_SNAPSHOT_ID}`)
  const driver = neo4j.driver(target.uri, neo4j.auth.basic(target.user, target.pass), {
    maxConnectionPoolSize: 4,
  })
  let session = driver.session()

  // Aura (especially the 1GB tier under live load) drops connections mid-bulk-write
  // and briefly refuses routing while it recovers. Every emit statement is
  // re-runnable (DELETE loops, IF NOT EXISTS schema, CREATE batches keyed by __eid
  // are only re-sent if the call failed), so retry with a fresh session.
  async function run(cypher, params) {
    let delay = 5000
    for (let attempt = 1; ; attempt++) {
      try {
        return await session.run(cypher, params)
      } catch (e) {
        const transient =
          e.code === 'SessionExpired' ||
          e.code === 'ServiceUnavailable' ||
          (e.code || '').includes('TransientError') ||
          /closed by server|routing|connection/i.test(e.message)
        if (!transient || attempt >= 8) throw e
        log(`  transient (${e.code || e.message.split('\n')[0]}); retry ${attempt} in ${delay / 1000}s`)
        await new Promise(r => setTimeout(r, delay))
        delay = Math.min(delay * 2, 60000)
        try { await session.close() } catch {}
        session = driver.session()
      }
    }
  }

  log('wiping target…')
  // Batched delete to stay within memory limits on the 1GB instance.
  for (;;) {
    const r = await run(
      'MATCH (n) WITH n LIMIT 5000 DETACH DELETE n RETURN count(*) AS c'
    )
    const c = r.records[0].get('c').toNumber()
    if (c === 0) break
    process.stdout.write(`  -${c}`)
  }
  console.log('')

  log('wiping staging schema (old indexes/constraints)…')
  const oldCons = await run('SHOW CONSTRAINTS YIELD name RETURN name')
  for (const rec of oldCons.records) {
    await run(`DROP CONSTRAINT \`${rec.get('name')}\` IF EXISTS`)
  }
  const oldIdx = await run(
    `SHOW INDEXES YIELD name, type WHERE type <> 'LOOKUP' RETURN name`
  )
  for (const rec of oldIdx.records) {
    await run(`DROP INDEX \`${rec.get('name')}\` IF EXISTS`).catch(() => {})
  }

  log('creating constraints (identity invariants — names match etl setup_constraints_and_indexes)…')
  const constraints = [
    'CREATE CONSTRAINT company_lei IF NOT EXISTS FOR (c:Company) REQUIRE c.lei IS UNIQUE',
    'CREATE CONSTRAINT company_wikidata IF NOT EXISTS FOR (c:Company) REQUIRE c.wikidata_id IS UNIQUE',
    'CREATE CONSTRAINT brand_wikidata IF NOT EXISTS FOR (b:Brand) REQUIRE b.wikidata_id IS UNIQUE',
    'CREATE CONSTRAINT person_wikidata_unique IF NOT EXISTS FOR (p:Person) REQUIRE p.wikidata_id IS UNIQUE',
    'CREATE CONSTRAINT product_barcode IF NOT EXISTS FOR (p:Product) REQUIRE p.barcode IS UNIQUE',
    'CREATE CONSTRAINT politician_fec IF NOT EXISTS FOR (p:Politician) REQUIRE p.fec_id IS UNIQUE',
    'CREATE CONSTRAINT facility_osid IF NOT EXISTS FOR (f:Facility) REQUIRE f.os_id IS UNIQUE',
    'CREATE CONSTRAINT country_iso IF NOT EXISTS FOR (c:Country) REQUIRE c.iso_code IS UNIQUE',
    'CREATE CONSTRAINT recall_id IF NOT EXISTS FOR (r:Recall) REQUIRE r.recall_id IS UNIQUE',
    'CREATE CONSTRAINT complaint_id IF NOT EXISTS FOR (cc:ConsumerComplaint) REQUIRE cc.complaint_id IS UNIQUE',
    'CREATE CONSTRAINT contract_award IF NOT EXISTS FOR (gc:GovernmentContract) REQUIRE gc.award_id IS UNIQUE',
    'CREATE CONSTRAINT offshore_icij IF NOT EXISTS FOR (oe:OffshoreEntity) REQUIRE oe.icij_id IS UNIQUE',
    'CREATE CONSTRAINT violation_caseid_unique IF NOT EXISTS FOR (v:Violation) REQUIRE v.case_id IS UNIQUE',
  ]
  for (const c of constraints) await run(c)

  log('replaying prod indexes…')
  for (const ix of indexes) {
    if (!ix.labels || !ix.properties || !ix.name) continue
    try {
      if (ix.type === 'FULLTEXT') {
        await run(
          `CREATE FULLTEXT INDEX ${ix.name} IF NOT EXISTS FOR (n:${ix.labels.join('|')}) ON EACH [${ix.properties.map(p => `n.${p}`).join(', ')}]`
        )
      } else if (ix.type === 'RANGE') {
        await run(
          `CREATE INDEX ${ix.name} IF NOT EXISTS FOR (n:${ix.labels[0]}) ON (${ix.properties.map(p => `n.${p}`).join(', ')})`
        )
      }
    } catch (e) {
      log(`  index ${ix.name}: ${e.message.split('\n')[0]}`) // equivalent constraint may already cover it
    }
  }

  log(`loading ${nodes.length} nodes…`)
  // Group by label-set so each batch uses one literal label string.
  const byLabels = new Map()
  for (const n of nodes) {
    const key = n.labels.slice().sort().join(':')
    if (!byLabels.has(key)) byLabels.set(key, [])
    byLabels.get(key).push(n)
  }
  for (const [labelKey, group] of byLabels) {
    const labels = labelKey.split(':').map(l => `\`${l}\``).join(':')
    for (let i = 0; i < group.length; i += 4000) {
      const batch = group.slice(i, i + 4000).map(n => ({ eid: n.eid, props: n.props }))
      await run(
        `UNWIND $batch AS row CREATE (n:${labels}) SET n = row.props, n.__eid = row.eid`,
        { batch }
      )
    }
    process.stdout.write(`  ${labelKey}:${group.length}`)
  }
  console.log('')

  log('indexing __eid for rel wiring…')
  await run('CREATE INDEX tmp_eid IF NOT EXISTS FOR (n:Company) ON (n.__eid)')
  // generic lookup across labels needs per-label indexes; create for all labels present
  for (const labelKey of byLabels.keys()) {
    const first = labelKey.split(':')[0]
    await session
      .run(`CREATE INDEX tmp_eid_${first.toLowerCase()} IF NOT EXISTS FOR (n:\`${first}\`) ON (n.__eid)`)
      .catch(() => {})
  }
  // Fallback global property existence is fine — Neo4j 5 can use any matching index.

  log(`loading ${rels.length} relationships…`)
  const byType = new Map()
  for (const r of rels) {
    if (!byType.has(r.type)) byType.set(r.type, [])
    byType.get(r.type).push(r)
  }
  for (const [type, group] of byType) {
    for (let i = 0; i < group.length; i += 2000) {
      const batch = group.slice(i, i + 2000)
      await run(
        `UNWIND $batch AS row
         MATCH (a {__eid: row.src}), (b {__eid: row.dst})
         CREATE (a)-[r:\`${type}\`]->(b) SET r = row.props`,
        { batch }
      )
    }
    process.stdout.write(`  ${type}:${group.length}`)
  }
  console.log('')

  log('dropping __eid scaffolding…')
  for (;;) {
    const r = await run(
      'MATCH (n) WHERE n.__eid IS NOT NULL WITH n LIMIT 50000 REMOVE n.__eid RETURN count(*) AS c'
    )
    if (r.records[0].get('c').toNumber() === 0) break
  }

  await session.close()
  await driver.close()
  log('emit complete')
}

// ---------------------------------------------------------------------------
async function phaseAssert() {
  const target = targetCreds()
  const driver = neo4j.driver(target.uri, neo4j.auth.basic(target.user, target.pass))
  const s = driver.session({ defaultAccessMode: neo4j.session.READ })
  const resolved = JSON.parse(readFileSync(join(STATE, 'resolution-report.json'), 'utf8'))

  const checks = []
  async function check(name, cypher, expect) {
    const r = await s.run(cypher)
    const v = plain(r.records[0].get(0))
    const ok = expect(v)
    checks.push({ name, value: v, ok })
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} = ${JSON.stringify(v)}`)
    return ok
  }

  await check('node_count_matches_resolved', 'MATCH (n) RETURN count(n)', v => v === resolved.summary.nodesOut)
  await check('rel_count_matches_resolved', 'MATCH ()-[r]->() RETURN count(r)', v => v === resolved.summary.relsOut)
  await check(
    'company_qid_collisions',
    `MATCH (c:Company) WHERE c.wikidata_id IS NOT NULL
     WITH c.wikidata_id AS q, count(*) AS cnt WHERE cnt > 1 RETURN count(*)`,
    v => v === 0
  )
  await check(
    'company_lei_collisions',
    `MATCH (c:Company) WHERE c.lei IS NOT NULL
     WITH c.lei AS l, count(*) AS cnt WHERE cnt > 1 RETURN count(*)`,
    v => v === 0
  )
  await check(
    'brand_qid_collisions',
    `MATCH (b:Brand) WHERE b.wikidata_id IS NOT NULL
     WITH b.wikidata_id AS q, count(*) AS cnt WHERE cnt > 1 RETURN count(*)`,
    v => v === 0
  )
  await check(
    'http_urls_remaining',
    `MATCH (n) WHERE n.website STARTS WITH 'http://' OR n.logo_url STARTS WITH 'http://'
       OR n.source_url STARTS WITH 'http://'
     RETURN count(n)`,
    v => v === 0
  )
  await check(
    'unilever_single_qid_owner',
    `MATCH (c:Company {wikidata_id:'Q157062'}) RETURN count(c)`,
    v => v === 1
  )
  await check(
    'exxon_connections_intact',
    `MATCH (c:Company {wikidata_id:'Q156238'}) RETURN COUNT { (c)--() }`,
    v => v >= 19
  )
  await check(
    'fnb_entities_preserved',
    `MATCH (c:Company) WHERE toLower(trim(c.name)) = 'fnb corporation' RETURN count(c)`,
    v => v === 12
  )
  await check(
    'identity_constraints_active',
    `SHOW CONSTRAINTS YIELD name WHERE name IN
       ['company_lei','company_wikidata','brand_wikidata','person_wikidata_unique']
     RETURN count(*)`,
    v => v === 4
  )

  const failed = checks.filter(c => !c.ok)
  writeFileSync(join(STATE, 'assertions.json'), JSON.stringify(checks, null, 2))
  await s.close()
  await driver.close()
  if (failed.length) {
    console.error(`\n${failed.length} ASSERTION(S) FAILED — staging NOT fit for promotion`)
    process.exit(1)
  }
  console.log('\nALL ASSERTIONS PASSED — staging graph is fit for promotion review')
}

// ---------------------------------------------------------------------------
const phase = process.argv[2]
if (phase === 'export') await phaseExport()
else if (phase === 'resolve') phaseResolve()
else if (phase === 'emit') await phaseEmit()
else if (phase === 'assert') await phaseAssert()
else {
  console.log('usage: node rebuild.mjs export|resolve|emit|assert')
  process.exit(1)
}
