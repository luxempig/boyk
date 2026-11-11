#!/usr/bin/env python3
"""Save the graph API's response for every company, brand, person and barcode.

  python3 scripts/demo/snapshot-graph.py <graph-backup-dir> <out-dir> [api-url] [concurrency]

Walks the node export from export-graph.py and stores each response as
<out-dir>/{companies,brands,persons,barcode}/<id>.json, exactly as the API
returned it. Point it at a local copy of api/index.js with the rate limit
raised (default http://localhost:3901/api). Safe to re-run: saved files are
skipped. Failures are listed in <out-dir>/errors.log.
"""
import asyncio, gzip, json, os, sys, time, urllib.parse
import aiohttp

BACKUP = os.path.join(sys.argv[1], "nodes.jsonl.gz")
OUT = sys.argv[2]
API = sys.argv[3] if len(sys.argv) > 3 else "http://localhost:3901/api"
CONC = int(sys.argv[4]) if len(sys.argv) > 4 else 24
LIMIT = None

def safe(i): return urllib.parse.quote(str(i), safe="")

jobs = []   # (kind, id, url path, [alias ids])
for line in gzip.open(BACKUP, "rt"):
    n = json.loads(line); labels = n["labels"]; p = n["props"]
    if "Company" in labels:
        lei, qid = p.get("lei"), p.get("wikidata_id")
        pid = lei or qid
        if pid: jobs.append(("companies", pid, f"companies/{safe(pid)}", [qid] if lei and qid else []))
    elif "Brand" in labels and p.get("wikidata_id"):
        jobs.append(("brands", p["wikidata_id"], f"brands/{safe(p['wikidata_id'])}", []))
    elif "Person" in labels and p.get("wikidata_id"):
        jobs.append(("persons", p["wikidata_id"], f"persons/{safe(p['wikidata_id'])}", []))
    elif "Product" in labels:
        b, u = p.get("barcode"), p.get("upc")
        if b: jobs.append(("barcode", b, f"products/barcode/{safe(b)}", [u] if u and u != b else []))
        elif u: jobs.append(("barcode", u, f"products/barcode/{safe(u)}", []))
if LIMIT: jobs = jobs[::max(1, len(jobs)//LIMIT)][:LIMIT]
for k in ("companies", "brands", "persons", "barcode"): os.makedirs(f"{OUT}/{k}", exist_ok=True)
print(len(jobs), "jobs", flush=True)

stats = {"ok": 0, "skip": 0, "404": 0, "err": 0}
errors = open(f"{OUT}/errors.log", "a")

async def worker(q, s):
    while True:
        kind, pid, path, aliases = await q.get()
        f = f"{OUT}/{kind}/{safe(pid)}.json"
        try:
            if os.path.exists(f): stats["skip"] += 1; continue
            for attempt in range(4):
                try:
                    async with s.get(f"{API}/{path}", timeout=aiohttp.ClientTimeout(total=60)) as r:
                        body = await r.read(); code = r.status
                    if code == 200:
                        json.loads(body)
                        for i in [pid] + aliases:
                            tmp = f"{OUT}/{kind}/{safe(i)}.json"
                            open(tmp + ".tmp", "wb").write(body); os.replace(tmp + ".tmp", tmp)
                        stats["ok"] += 1; break
                    if code == 404: stats["404"] += 1; break
                    raise RuntimeError(f"HTTP {code}")
                except Exception as e:
                    if attempt == 3:
                        stats["err"] += 1; errors.write(f"{kind}\t{pid}\t{e}\n"); errors.flush()
                    else: await asyncio.sleep(2 * (attempt + 1))
        finally:
            q.task_done()

async def main():
    q = asyncio.Queue()
    for j in jobs: q.put_nowait(j)
    t = time.time()
    async with aiohttp.ClientSession(connector=aiohttp.TCPConnector(limit=CONC)) as s:
        ws = [asyncio.create_task(worker(q, s)) for _ in range(CONC)]
        async def report():
            while True:
                await asyncio.sleep(60)
                done = sum(stats.values())
                print(f"{done}/{len(jobs)} {stats} {done/(time.time()-t):.0f}/s", flush=True)
        rep = asyncio.create_task(report())
        await q.join(); rep.cancel()
        for w in ws: w.cancel()
    print("DONE", stats, f"{time.time()-t:.0f}s", flush=True)
asyncio.run(main())
