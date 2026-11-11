#!/usr/bin/env python3
"""Export every node and relationship of the Neo4j graph to gzipped JSONL.

  python3 scripts/demo/export-graph.py <out-dir>

Writes nodes.jsonl.gz, rels.jsonl.gz and manifest.json (counts, labels,
constraints, indexes). Reads NEO4J_URI / NEO4J_USER / NEO4J_PASSWORD from .env.
This is both the full backup of the graph and the input for
build-search-index.py and snapshot-graph.py.
"""
import gzip, json, os, sys, time
from neo4j import GraphDatabase

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

def env(k, path=os.path.join(ROOT, ".env")):
    for line in open(path):
        if line.startswith(k + "="):
            return line.split("=", 1)[1].strip().strip("\"'")

prefix = ""
out = sys.argv[1]
os.makedirs(out, exist_ok=True)
uri = env(f"NEO4J_{prefix}URI"); user = env(f"NEO4J_{prefix}USER") or "neo4j"
pw = env(f"NEO4J_{prefix}PASSWORD"); db = env(f"NEO4J_{prefix}DATABASE") or "neo4j"
drv = GraphDatabase.driver(uri, auth=(user, pw))

def conv(v):
    if isinstance(v, (str, int, float, bool)) or v is None: return v
    if isinstance(v, (list, tuple)): return [conv(x) for x in v]
    if isinstance(v, dict): return {k: conv(x) for k, x in v.items()}
    return str(v)          # dates, datetimes, points

def dump(name, count_q, page_q):
    with drv.session(database=db) as s:
        total = s.run(count_q).single()[0]
    n, last = 0, -1
    with gzip.open(f"{out}/{name}.jsonl.gz", "wt") as f:
        while True:
            with drv.session(database=db) as s:
                rows = list(s.run(page_q, last=last))
            if not rows: break
            for r in rows:
                f.write(json.dumps(conv(dict(r)), ensure_ascii=False) + "\n")
            n += len(rows); last = rows[-1]["id"]
            print(f"{name}: {n}/{total}", flush=True)
    assert n == total, f"{name}: wrote {n}, expected {total}"
    return total

t = time.time()
nodes = dump("nodes", "MATCH (n) RETURN count(n)",
    "MATCH (n) WHERE id(n) > $last WITH n ORDER BY id(n) LIMIT 20000 "
    "RETURN id(n) AS id, labels(n) AS labels, properties(n) AS props")
rels = dump("rels", "MATCH ()-[r]->() RETURN count(r)",
    "MATCH (a)-[r]->(b) WHERE id(r) > $last WITH a, r, b ORDER BY id(r) LIMIT 20000 "
    "RETURN id(r) AS id, type(r) AS type, id(a) AS start, id(b) AS end, properties(r) AS props")
with drv.session(database=db) as s:
    schema = {
        "labels": [dict(r) for r in s.run("MATCH (n) UNWIND labels(n) AS l RETURN l AS label, count(*) AS n ORDER BY n DESC")],
        "rel_types": [dict(r) for r in s.run("MATCH ()-[r]->() RETURN type(r) AS type, count(*) AS n ORDER BY n DESC")],
        "constraints": [conv(dict(r)) for r in s.run("SHOW CONSTRAINTS")],
        "indexes": [conv(dict(r)) for r in s.run("SHOW INDEXES")],
    }
json.dump({"nodes": nodes, "rels": rels, "exported_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), **schema},
          open(f"{out}/manifest.json", "w"), indent=1)
print(f"done: {nodes} nodes, {rels} rels in {time.time()-t:.0f}s")
