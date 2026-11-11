#!/usr/bin/env python3
"""Export the graph's brands and companies for the Open Food Facts index build.

build.py matches OFF brand and owner strings against this snapshot; it never
creates graph nodes, so the snapshot is the only thing that decides what a
barcode can resolve to.

Public bodies (Company.non_business) are left out: an owner string should never
resolve to a city or a university.

Usage: python3 export_match_data.py [--out /tmp/graph-match-data.json]
"""
import argparse, json, os, sys

from neo4j import GraphDatabase


def env(path: str) -> dict:
    out = {}
    for line in open(path):
        if "=" in line and not line.startswith("#"):
            k, _, v = line.partition("=")
            out[k.strip()] = v.strip().strip('"').strip("'")
    return out


BRANDS = """
MATCH (b:Brand) WHERE b.name IS NOT NULL AND trim(b.name) <> ""
OPTIONAL MATCH (b)-[:OWNED_BY]->(c:Company)
RETURN b.name AS name, b.wikidata_id AS qid,
       coalesce(c.lei, c.wikidata_id) AS company_id, c.name AS company_name
"""

# `rank` breaks ties between companies that share a name: the one with more
# brands and subsidiaries is the group a shopper means by "Safeway".
COMPANIES = """
MATCH (c:Company)
WHERE c.name IS NOT NULL AND trim(c.name) <> ""
  AND (c.lei IS NOT NULL OR c.wikidata_id IS NOT NULL)
  AND coalesce(c.non_business, false) = false
RETURN coalesce(c.lei, c.wikidata_id) AS id, c.name AS name,
       coalesce(c.brand_count, 0) + coalesce(c.subsidiary_count, 0)
         + CASE WHEN c.website IS NOT NULL THEN 1 ELSE 0 END AS rank
"""

# Ownership edges, so build.py can tell a parent/child disagreement (both right)
# from two unrelated companies (one of them wrong). Disputed edges are the ones
# a repair retracted, so they don't count as relatives.
RELATIONS = """
MATCH (c:Company)-[r:SUBSIDIARY_OF]->(p:Company)
WHERE NOT coalesce(r.disputed, false)
  AND (c.lei IS NOT NULL OR c.wikidata_id IS NOT NULL)
  AND (p.lei IS NOT NULL OR p.wikidata_id IS NOT NULL)
RETURN coalesce(c.lei, c.wikidata_id) AS child, coalesce(p.lei, p.wikidata_id) AS parent
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="/tmp/graph-match-data.json")
    ap.add_argument("--env", default=os.path.expanduser("~/Projects/boyk_dev/.env"))
    args = ap.parse_args()

    cfg = env(args.env)
    driver = GraphDatabase.driver(cfg["NEO4J_URI"], auth=("neo4j", cfg["NEO4J_PASSWORD"]))
    with driver.session() as session:
        brands = [dict(r) for r in session.run(BRANDS)]
        companies = [dict(r) for r in session.run(COMPANIES)]
        relations = [[r["child"], r["parent"]] for r in session.run(RELATIONS)]
    driver.close()

    with open(args.out, "w") as f:
        json.dump({"brands": brands, "companies": companies, "relations": relations}, f)
    owned = sum(1 for b in brands if b.get("company_id"))
    print(f"wrote {args.out}: {len(brands):,} brands ({owned:,} with an owner), "
          f"{len(companies):,} companies, {len(relations):,} ownership edges")


if __name__ == "__main__":
    sys.exit(main())
