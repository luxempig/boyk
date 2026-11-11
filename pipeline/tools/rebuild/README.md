# Graph identity rebuild

One-shot pipeline that repairs the knowledge graph's identity pollution and loads the
clean result into the staging AuraDB for validation, plus the permanent guards that
prevent the pollution from coming back.

## What it fixes (measured against prod, 2026-06-10)

- **309 company + 211 brand wikidata QIDs stamped onto multiple nodes.** Name-matched
  enrichment stamped the same QID onto distinct legal entities (12 different "FNB
  Corporation" LEIs all carried Q5426765), and ghost duplicate nodes (QID-only) split
  one company's connections across two nodes.
- **`http://` URLs** in `website` / `logo_url` / `source_url` (mixed-content warnings
  in the app).
- **The declared uniqueness constraints have never been active.** `setup_constraints_and_indexes`
  declares `company_wikidata` UNIQUE, but the constraint can't be created while violating
  data exists — and the failure was logged at DEBUG. Every ETL run since the first
  collision silently ran without identity enforcement.

## Resolution rules

For each QID owned by >1 node (per label):

| Case                                     | Action                                                        | Reference safety                                   |
| ---------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------- |
| Loser has an LEI (distinct legal entity) | Unstamp the QID; record `qid_group`                           | Public ID was already the LEI — unchanged          |
| Loser has no LEI (ghost duplicate)       | Merge into winner: rewire rels, fill missing props, drop node | Its public ID (the QID) now resolves to the winner |

Winner = highest degree (tie: has LEI). Distinct legal entities are **never merged** —
same-name/same-domain companies (FNB ×12, Unilever PLC vs NV) are real separate entities.

## Usage

```bash
node rebuild.mjs export    # read-only dump of prod (nodes/rels/indexes → state/)
node rebuild.mjs resolve   # local transform; writes state/resolution-report.json
node rebuild.mjs emit      # WIPES STAGING, loads resolved graph + constraints/indexes
node rebuild.mjs assert    # quality gate — must pass before promotion is considered
```

Credentials come from `REBUILD_ENV_FILE` (default `~/Projects/boyk_dev/.env`):
`NEO4J_URI/USER/PASSWORD` (prod, read-only use) and `NEO4J_STAGING_*` (emit target).
`emit` refuses to run if the target URI looks like prod.

## Promotion (separate, deliberate step — see runbook)

See `docs/identity-rebuild-cutover.md` in this repo. Promotion is a human go/no-go:
the assert phase passing makes staging _eligible_, not auto-promoted.

## The permanent guards (in this branch)

- `merge_companies` only stamps a QID/LEI onto a node when no other node owns it
  (`EXISTS` guard), and refuses `merge_field="name"` outright.
- SEC supply-chain mining `MATCH`es companies instead of `MERGE`-ing them — regex-mined
  names can no longer mint nodes.
- Schema-statement failures now log at WARNING with an explicit "declared invariants
  are NOT being enforced" summary — a failing uniqueness constraint can't hide again.
- Once promoted, the active UNIQUE constraints make re-pollution a loud write error
  instead of silent corruption.
