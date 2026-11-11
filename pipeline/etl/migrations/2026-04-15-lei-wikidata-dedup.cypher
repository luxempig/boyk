// LEI ↔ Wikidata-only Company dedup — 2026-04-15
//
// Background: Wikidata models the same legal entity under multiple QIDs
// (e.g. "Amazon" Q3884 vs "Amazon.com, Inc." Q133848906). The GLEIF stage
// anchors one of them via LEI; the other arrives as a Wikidata-only
// Company carrying the relationships. This migration merges the orphan
// into the LEI-anchored canonical, preserving edges + properties.
//
// Safety: APOC's mergeNodes with `properties: 'discard'` keeps the
// canonical's value when conflicts arise (canonical = first node in array).
// Only matches with name >= 5 chars to avoid short-name collisions
// ("IBM", "ATT", etc.).
//
// Run order: pass 1 first (high-value merges), pass 2 second (everything else).
// Idempotent — safe to re-run.


// ── Pass 1: high-value merges (orphan has >= 3 edges) ─────────
MATCH (lei:Company) WHERE lei.lei IS NOT NULL AND size(lei.name) >= 5
MATCH (wd:Company {name: lei.name}) WHERE wd.lei IS NULL AND wd.wikidata_id IS NOT NULL
WITH lei, wd
MATCH (wd)-[r]-()
WITH lei, wd, count(r) AS orphan_deg
WHERE orphan_deg >= 3
WITH collect([lei, wd]) AS pairs
UNWIND pairs AS pair
WITH pair[0] AS canonical, pair[1] AS orphan
CALL apoc.refactor.mergeNodes([canonical, orphan], {properties: 'discard', mergeRels: true}) YIELD node
RETURN count(node) AS pass_1_merged;


// ── Pass 2: any remaining matches with at least 1 edge ────────
MATCH (lei:Company) WHERE lei.lei IS NOT NULL AND size(lei.name) >= 5
MATCH (wd:Company {name: lei.name}) WHERE wd.lei IS NULL AND wd.wikidata_id IS NOT NULL
WITH lei, wd
MATCH (wd)-[r]-()
WITH lei, wd, count(r) AS orphan_deg
WHERE orphan_deg >= 1
WITH collect([lei, wd]) AS pairs
UNWIND pairs AS pair
WITH pair[0] AS canonical, pair[1] AS orphan
CALL apoc.refactor.mergeNodes([canonical, orphan], {properties: 'discard', mergeRels: true}) YIELD node
RETURN count(node) AS pass_2_merged;


// ── Verify ────────────────────────────────────────────────────
// After both passes, no LEI-anchored Company should share an exact name
// with a Wikidata-only Company that has any edges.
MATCH (lei:Company) WHERE lei.lei IS NOT NULL AND size(lei.name) >= 5
MATCH (wd:Company {name: lei.name}) WHERE wd.lei IS NULL AND wd.wikidata_id IS NOT NULL
WITH wd
MATCH (wd)--()
RETURN count(*) AS remaining_should_be_zero;
