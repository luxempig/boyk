#!/usr/bin/env python3
"""Build the static search index the demo Worker answers searches from.

  python3 scripts/demo/build-search-index.py <graph-backup-dir> <out-dir>

Reads nodes.jsonl.gz / rels.jsonl.gz (written by export-graph.py) and writes
<out-dir>/search/{companies,brands}/<2-char-prefix>.json. Every name is filed
under the first two characters of each of its words, so a query only ever
needs one small file. The Worker (public/_worker.js, snapshotSearch) applies
the same tokenizer and stopword list, so keep the two in step.
"""
import gzip, json, math, os, sys, unicodedata
from collections import defaultdict

SRC, OUT = sys.argv[1], sys.argv[2]
MAX_PER_SHARD = 6000

STOPWORDS = set("""the and of inc ltd limited llc gmbh co corp corporation company holdings holding
group sa ag plc bv nv ab as oy spa srl sarl pty pte kg international de la le et und""".split())


def tokens(text):
    text = unicodedata.normalize("NFKD", text or "")
    text = "".join(c for c in text if not unicodedata.combining(c)).lower()
    out, cur = [], []
    for c in text:
        if ("a" <= c <= "z") or ("0" <= c <= "9"):
            cur.append(c)
        elif cur:
            out.append("".join(cur)); cur = []
    if cur:
        out.append("".join(cur))
    return out


def prefixes(name):
    toks = tokens(name)
    keys = {t[:2] for t in toks if len(t) >= 2 and t not in STOPWORDS}
    if not keys:
        keys = {t[:2] for t in toks if len(t) >= 2}
    compact = "".join(toks)          # "H&M" -> "hm", "AT&T" -> "att"
    if len(compact) >= 2:
        keys.add(compact[:2])
    return keys


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


companies, brands, by_node = [], {}, {}
for line in gzip.open(f"{SRC}/nodes.jsonl.gz", "rt"):
    n = json.loads(line); p = n["props"]
    if "Company" in n["labels"]:
        cid = p.get("lei") or p.get("wikidata_id")
        if not cid or not p.get("name"):
            continue
        by_node[n["id"]] = (cid, p["name"])
        if p.get("non_business"):
            continue                    # reachable by link, not by search
        rev, emp = num(p.get("revenue")), num(p.get("employees"))
        rank = (
            (math.log10(rev + 1) / 3.0 if rev and rev > 0 else 0)
            + (math.log10(emp + 1) if emp and emp > 0 else 0)
            + (num(p.get("subsidiary_count")) or 0) * 0.3
            + (num(p.get("brand_count")) or 0) * 0.3
            + (1.0 if p.get("logo_url") else 0)
            + (1.5 if p.get("stock_exchange") else 0)
            + (num(p.get("source_count")) or 0) * 0.2
        )
        desc = p.get("description")
        rec = {
            "id": cid, "name": p["name"], "logo_url": p.get("logo_url"), "website": p.get("website"),
            "description": desc[:200] if isinstance(desc, str) else desc,
            "lei": p.get("lei"), "ticker": p.get("ticker"), "country": p.get("country"),
            "wikidata_id": p.get("wikidata_id"), "industry": p.get("industry"),
            "employees": p.get("employees"), "sanctioned": p.get("sanctioned"),
            "sanction_lists": p.get("sanction_lists"), "sanction_programs": p.get("sanction_programs"),
            "brand_count": p.get("brand_count"), "subsidiary_count": p.get("subsidiary_count"),
        }
        rec = {k: v for k, v in rec.items() if v is not None}
        rec["_r"] = round(rank, 2)
        companies.append(rec)
    elif "Brand" in n["labels"] and p.get("wikidata_id") and p.get("name"):
        brands[n["id"]] = {"id": p["wikidata_id"], "name": p["name"], "logo_url": p.get("logo_url"),
                           "company": None, "_r": 1.0 if p.get("logo_url") else 0}

for line in gzip.open(f"{SRC}/rels.jsonl.gz", "rt"):
    r = json.loads(line)
    if r["type"] == "OWNED_BY" and r["start"] in brands and r["end"] in by_node:
        cid, cname = by_node[r["end"]]
        brands[r["start"]]["company"] = {"id": cid, "name": cname}
        brands[r["start"]]["_r"] += 1


def write(kind, records):
    shards = defaultdict(list)
    for rec in records:
        for key in prefixes(rec["name"]):
            shards[key].append(rec)
    os.makedirs(f"{OUT}/search/{kind}", exist_ok=True)
    dropped = 0
    for key, rows in shards.items():
        rows.sort(key=lambda r: -r["_r"])
        dropped += max(0, len(rows) - MAX_PER_SHARD)
        with open(f"{OUT}/search/{kind}/{key}.json", "w") as f:
            json.dump(rows[:MAX_PER_SHARD], f, ensure_ascii=False, separators=(",", ":"))
    sizes = sorted(((len(v), k) for k, v in shards.items()), reverse=True)
    print(f"{kind}: {len(records)} records, {len(shards)} shards, largest {sizes[:4]}, "
          f"{dropped} low-ranked entries dropped by the {MAX_PER_SHARD}-per-shard cap")


write("companies", companies)
write("brands", list(brands.values()))
