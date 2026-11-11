# Identity rebuild — cutover runbook

How to promote the rebuilt graph (staging `d74b1f99`) over prod (`362d2469`).
Promotion is a **manual go/no-go** — nothing in CI or the rebuild tool does this
automatically.

## Preconditions (all must hold)

1. `node tools/rebuild/rebuild.mjs assert` exits 0 against staging (all gates pass).
2. Spot checks in staging look right:
   - `MATCH (c:Company {wikidata_id:'Q157062'}) RETURN c.name, c.lei` → exactly one
     Unilever (PLC, `549300MKFYEKVRWML317`).
   - `MATCH (c:Company {wikidata_id:'Q156238'}) RETURN COUNT { (c)--() }` → ≥ 19.
   - FNB Corporation count = 12 (distinct legal entities preserved).
3. The `rebuild/identity-resolver` branch (writer guards + schema-failure visibility)
   is merged and deployed to the Lambda — otherwise the next ETL run can recreate
   collisions before the constraints reject them noisily.
4. No ETL run in flight (check EventBridge schedule — daily 3 AM UTC; pick a window
   well clear of it, or disable the rule for the duration).

## Cutover options

**Option A — clone staging over prod (recommended).** Aura supports clone-to-existing-
instance. Console → instance `d74b1f99` → Clone → target `362d2469` (overwrite).
Prod has automatic Aura backups; note the latest snapshot time before starting.
Zero config changes anywhere (App Runner, Lambda, worker all keep pointing at prod's
URI). Edge caches (12h TTL) will serve stale company payloads for up to 12h or until
purged — purge the Cloudflare zone cache after cutover for instant consistency.

**Option B — repoint clients at staging.** Change `NEO4J_URI` on App Runner and the
Lambda to `d74b1f99`. Not recommended: instance sizes differ (1GB vs 4GB), every
consumer's config must move, and "staging" becomes prod in all but name.

## Post-cutover verification

1. `curl -s https://boyk.org/neo4j-api/api/health` → `neo4j: connected`.
2. `curl -s https://boyk.org/neo4j-api/api/companies/Q156238` → connections present.
3. Network search for "unilever" in the app → exactly one top-level Unilever.
4. `SHOW CONSTRAINTS` on prod → `company_lei`, `company_wikidata`, `brand_wikidata`,
   `person_wikidata_unique` all ONLINE. This is the proof the invariants are finally
   enforced.
5. Watch the next nightly ETL run's logs for `SCHEMA STATEMENT FAILED` warnings (there
   should be none) and for constraint-violation write errors (each one is a stamping
   attempt that would previously have corrupted identity silently — investigate the
   offending stage, don't relax the constraint).

## Rollback

Aura → instance `362d2469` → Restore from the pre-cutover automatic snapshot.
Frontend/API need no changes (URI never changed under Option A).
