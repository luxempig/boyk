// Boyk data-quality cleanup — 2026-04-14
//
// Run order: top to bottom. Each section is idempotent and safe to re-run.
// Safety: take an Aura snapshot via the console BEFORE running section A.
// Run interactively — review counts after each step.

// ── Baseline counts (read-only) ───────────────────────────────
MATCH (c:Company)
OPTIONAL MATCH (c)-[r]-()
WITH c, count(r) AS deg
RETURN
  count(c) AS total_companies,
  sum(CASE WHEN deg = 0 THEN 1 ELSE 0 END) AS isolated,
  sum(CASE WHEN deg = 0
            AND c.lei IS NULL
            AND (c.website IS NULL OR c.website = '')
            AND (c.industry IS NULL OR c.industry = '')
       THEN 1 ELSE 0 END) AS dead_weight;

// Expected: total_companies≈248671, isolated≈188647, dead_weight≈144631


// ── A. Delete dead-weight Companies (batched) ─────────────────
// Run this block REPEATEDLY until 0 rows are returned.
// Each pass deletes up to 10,000 rows.
MATCH (c:Company)
WHERE NOT (c)--()
  AND c.lei IS NULL
  AND (c.website IS NULL OR c.website = '')
  AND (c.industry IS NULL OR c.industry = '')
WITH c LIMIT 10000
DETACH DELETE c
RETURN count(*) AS deleted_this_batch;


// ── B. Delete SUBSIDIARY_OF self-loops ────────────────────────
MATCH (a:Company)-[r:SUBSIDIARY_OF]->(a)
DELETE r
RETURN count(*) AS self_loops_removed;
// Expected: 8


// ── C. Fix ownership_percentage > 100 ─────────────────────────
// All 17 affected rows divide cleanly by 100 → plausible % values.
MATCH ()-[r:SUBSIDIARY_OF]->()
WHERE r.ownership_percentage > 100
SET r.ownership_percentage = r.ownership_percentage / 100.0
RETURN count(*) AS percentages_fixed;
// Expected: 17


// ── D. Backfill SELLS.last_confirmed ──────────────────────────
MATCH ()-[r:SELLS]->()
WHERE r.last_confirmed IS NULL
SET r.last_confirmed = coalesce(r.first_seen, toString(datetime()))
RETURN count(*) AS sells_backfilled;
// Expected: ~4509


// ── E. Backfill OWNED_BY missing confidence/last_confirmed ────
MATCH ()-[r:OWNED_BY]->()
WHERE r.confidence IS NULL
SET r.confidence = 0.5
RETURN count(*) AS owned_by_confidence_backfilled;

MATCH ()-[r:OWNED_BY]->()
WHERE r.last_confirmed IS NULL
SET r.last_confirmed = datetime()
RETURN count(*) AS owned_by_last_confirmed_backfilled;
// Expected: ~365 each


// ── Final counts (read-only) ──────────────────────────────────
MATCH (c:Company)
OPTIONAL MATCH (c)-[r]-()
WITH c, count(r) AS deg
RETURN
  count(c) AS total_companies,
  sum(CASE WHEN deg = 0 THEN 1 ELSE 0 END) AS isolated,
  sum(CASE WHEN deg = 0
            AND c.lei IS NULL
            AND (c.website IS NULL OR c.website = '')
            AND (c.industry IS NULL OR c.industry = '')
       THEN 1 ELSE 0 END) AS dead_weight_should_be_zero;

MATCH ()-[r:SUBSIDIARY_OF]->() WHERE r.ownership_percentage > 100
RETURN count(*) AS over_100_should_be_zero;

MATCH (a)-[r:SUBSIDIARY_OF]->(a) RETURN count(*) AS self_loops_should_be_zero;

MATCH ()-[r:SELLS]->() WHERE r.last_confirmed IS NULL
RETURN count(*) AS sells_missing_should_be_zero;
