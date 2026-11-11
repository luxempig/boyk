#!/usr/bin/env python3
"""Build UEI -> graph-company crosswalk from the SAM.gov Entity Management
Public V2 monthly extract. Matches SAM legal/DBA names (normalized) against the
graph's existing companies (LEI/QID keyed). Output feeds identifier-based
matching for USAspending and other UEI-keyed federal datasets.

Usage: python3 sam_crosswalk.py SAM_PUBLIC_MONTHLY_V2_*.dat [--match-data /tmp/graph-match-data.json]
"""
import argparse, csv, json, re, sys
from collections import defaultdict

NORM_RE = re.compile(r"[^a-z0-9]+")
SUFFIX_RE = re.compile(
    r"\b(incorporated|corporation|company|limited|holdings|group|inc|corp|llc|llp|ltd|plc|co|sa|ag|nv|bv|gmbh|spa)\b"
)

def norm(s):
    s = s.lower()
    s = SUFFIX_RE.sub(" ", s)
    return NORM_RE.sub("", s)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dat")
    ap.add_argument("--match-data", default="/tmp/graph-match-data.json")
    ap.add_argument("--out", default="/tmp/uei_lei_crosswalk.csv")
    args = ap.parse_args()

    data = json.load(open(args.match_data))
    lookup = defaultdict(list)
    for c in data["companies"]:
        if c.get("name"):
            k = norm(c["name"])
            if len(k) >= 4:
                lookup[k].append((c["id"], c["name"]))
    # drop ambiguous normalized names (different graph companies sharing one norm)
    lookup = {k: v[0] for k, v in lookup.items() if len({i for i, _ in v}) == 1}
    print(f"graph name lookup: {len(lookup)} unambiguous entries", flush=True)

    total = matched = 0
    rows = []
    with open(args.dat, encoding="latin-1") as f:
        next(f)  # BOF header
        for line in f:
            p = line.split("|")
            if len(p) < 21:
                continue
            total += 1
            uei, cage, legal, dba = p[0], p[4], p[10], p[11]
            country = p[20]
            for name in (legal, dba):
                if not name:
                    continue
                hit = lookup.get(norm(name))
                if hit:
                    rows.append((uei, cage, legal, country, hit[0], hit[1]))
                    matched += 1
                    break

    with open(args.out, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["uei", "cage", "sam_legal_name", "sam_country", "company_id", "company_name"])
        w.writerows(rows)
    print(json.dumps({"sam_records": total, "matched_to_graph": matched, "out": args.out}))

if __name__ == "__main__":
    sys.exit(main())
