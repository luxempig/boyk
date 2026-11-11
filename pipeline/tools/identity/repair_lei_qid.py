#!/usr/bin/env python3
"""Repair Company nodes whose wikidata_id is not an item Wikidata gives their LEI.

Stage 1 only fills a missing wikidata_id, so a wrong one persists and misroutes
every edge written by QID (2026-09: the Huawei LEI node held Lenovo's QID, so
Lenovo's brands showed Huawei as their owner). Stage 1 logs an ERROR when it
sees one; this fixes them, following the 2026-06 identity-rebuild rules:

  1. Edges on the node written for the wrong QID (an evidence record id names it
     exactly) move to a node for that QID, created if needed.
  2. A node holding the right QID with no LEI is a ghost: merged into the LEI node.
     One with a DIFFERENT LEI is a separate legal entity and is never merged.
  3. The LEI node takes the right QID. Its public ID (the LEI) never changes, so
     Supabase boycott references keep resolving.

Dry run by default. With --apply it writes a JSON backup of every touched node
and its relationships first. Take an Aura snapshot before applying.

Usage: NEO4J_URI=... NEO4J_PASSWORD=... python3 repair_lei_qid.py [--apply] [--backup PATH]
"""
import argparse, json, os, sys
from collections import defaultdict
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "etl"))
from config import Config  # noqa: E402
from neo4j_writer import Neo4jWriter  # noqa: E402
from wikidata_client import WikidataClient  # noqa: E402

TAG = "identity_repair_" + datetime.now(timezone.utc).strftime("%Y-%m-%d")


def find_mismatches(writer, wd):
    with writer.driver.session() as s:
        nodes = s.run("""MATCH (c:Company) WHERE c.lei IS NOT NULL AND c.wikidata_id IS NOT NULL
                         RETURN c.lei AS lei, c.wikidata_id AS q, c.name AS name,
                                COUNT { (c)--() } AS deg""").data()
    leis = sorted({n["lei"] for n in nodes})
    lei2q = defaultdict(set)
    for i in range(0, len(leis), 400):
        vals = " ".join(f'"{l}"' for l in leis[i:i + 400])
        for r in wd._query('SELECT ?item ?lei WHERE { VALUES ?lei { %s } ?item wdt:P1278 ?lei }' % vals):
            lei2q[wd._val(r, "lei")].add(wd._val(r, "item"))
    out = []
    for n in nodes:
        items = lei2q.get(n["lei"])
        if items and n["q"] not in items:
            out.append({**n, "right": sorted(items)[0] if len(items) == 1 else None, "items": sorted(items)})
    return out


MOVE_EDGES = """
MATCH (n:Company {lei: $lei})-[r]-(x)
WHERE any(k IN coalesce(r.evidence_record_ids, []) WHERE $wrong IN split(toString(k), '|'))
RETURN elementId(r) AS id, startNode(r) = n AS out
"""


def repair(tx, p, labels, dry):
    if not p["right"]:
        return {**p, "result": f"SKIPPED: LEI is on several Wikidata items {p['items']}"}
    edges = tx.run(MOVE_EDGES, lei=p["lei"], wrong=p["q"]).data()
    ghost = tx.run("""MATCH (g:Company {wikidata_id: $r}) WHERE g.lei IS NULL OR g.lei <> $lei
                      RETURN g.lei AS lei, elementId(g) AS id""", r=p["right"], lei=p["lei"]).data()
    if ghost and ghost[0]["lei"]:
        return {**p, "result": f"SKIPPED: {p['right']} is on another legal entity ({ghost[0]['lei']})"}
    res = {**p, "moved": len(edges), "merged_ghost": bool(ghost)}
    if dry:
        return {**res, "result": "dry run"}
    now = datetime.now(timezone.utc).isoformat()
    tx.run("MATCH (n:Company {lei: $lei}) REMOVE n.wikidata_id", lei=p["lei"])
    if edges:
        tx.run("""MERGE (w:Company {wikidata_id: $wrong})
                  ON CREATE SET w.name = $name, w.data_sources = ['wikidata'], w.created_via = $tag,
                                w.first_seen = $now, w.last_updated = $now""",
               wrong=p["q"], name=labels.get(p["q"], p["q"]), tag=TAG, now=now)
        for e in edges:
            proc = "apoc.refactor.from" if e["out"] else "apoc.refactor.to"
            tx.run(f"""MATCH ()-[r]->() WHERE elementId(r) = $id MATCH (w:Company {{wikidata_id: $wrong}})
                       CALL {proc}(r, w) YIELD output RETURN count(*)""", id=e["id"], wrong=p["q"])
    if ghost:
        tx.run("""MATCH (n:Company {lei: $lei}), (g) WHERE elementId(g) = $gid
                  CALL apoc.refactor.mergeNodes([n, g], {properties: 'discard', mergeRels: true}) YIELD node
                  RETURN count(*)""", lei=p["lei"], gid=ghost[0]["id"])
    tx.run("MATCH (n:Company {lei: $lei}) SET n.wikidata_id = $right, n.identity_repaired = $tag",
           lei=p["lei"], right=p["right"], tag=TAG)
    return {**res, "result": "done"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--backup", default=f"{TAG}.backup.json")
    args = ap.parse_args()
    cfg = Config(); writer = Neo4jWriter(cfg); wd = WikidataClient(cfg)
    plan = find_mismatches(writer, wd)
    print(f"{len(plan)} nodes carry a QID Wikidata gives to another item")
    if not plan:
        return
    wrongs = sorted({p["q"] for p in plan})
    labels = {wd._val(r, "i"): wd._val(r, "l") for r in wd._query(
        'SELECT ?i ?l WHERE { VALUES ?i { %s } ?i rdfs:label ?l FILTER(lang(?l) IN ("en","mul")) }'
        % " ".join("wd:" + q for q in wrongs))}
    # A node whose right QID sits on another mismatched node must wait for that
    # one to release it (EIDP held DuPont's QID): process releasers first.
    held = {p["q"] for p in plan}
    plan.sort(key=lambda p: p["right"] in held)
    if args.apply:
        with writer.driver.session() as s:
            dump = s.run("""MATCH (n:Company) WHERE n.lei IN $l OR n.wikidata_id IN $q
                            OPTIONAL MATCH (n)-[r]-(x)
                            RETURN properties(n) AS node, collect({type: type(r), out: startNode(r) = n,
                                   other: coalesce(x.lei, x.wikidata_id, x.barcode, x.name), props: properties(r)}) AS rels""",
                         l=[p["lei"] for p in plan], q=sorted(held | {p["right"] for p in plan if p["right"]})).data()
        with open(args.backup, "w") as f:
            json.dump(dump, f, default=str)
        print(f"backed up {len(dump)} nodes to {args.backup}")
    with writer.driver.session() as s:
        for p in plan:
            r = s.execute_write(lambda tx: repair(tx, p, labels, not args.apply))
            print(f"  {r['name'][:30]:30} {r['q']:11} -> {str(r['right']):11} "
                  f"moved {r.get('moved', '-')} merged ghost {r.get('merged_ghost', '-')}: {r['result']}")
    writer.driver.close()


if __name__ == "__main__":
    main()
