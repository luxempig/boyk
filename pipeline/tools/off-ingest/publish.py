#!/usr/bin/env python3
"""Compare a fresh build against the live index, back the live one up, publish.

  python3 publish.py diff               # live (R2) vs out/offidx: coverage + moved barcodes
  python3 publish.py backup <name>      # copy live offidx/ + datasets/ to boyk-backups/<name>/
  python3 publish.py publish            # upload out/offidx shards + the ODbL extract

Reads R2 credentials (CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY)
from the app repo's .env, like export_match_data.py reads the Neo4j ones.
Always back up before publishing: the worker serves offidx/ directly.
"""
import json, os, sys
from collections import Counter
from concurrent.futures import ThreadPoolExecutor

import boto3

from export_match_data import env

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
LIVE_CACHE = os.path.join(OUT, "offidx-live")
BUCKET, BACKUPS = "boyk-assets", "boyk-backups"
ENV = os.environ.get("BOYK_ENV", os.path.join(HERE, "..", "..", "..", "boyk_dev", ".env"))


def client():
    e = env(ENV)
    return boto3.client("s3", endpoint_url=f"https://{e['CLOUDFLARE_ACCOUNT_ID']}.r2.cloudflarestorage.com",
                        aws_access_key_id=e["R2_ACCESS_KEY_ID"],
                        aws_secret_access_key=e["R2_SECRET_ACCESS_KEY"], region_name="auto")


def list_keys(s3, prefix):
    keys, token = [], None
    while True:
        r = s3.list_objects_v2(Bucket=BUCKET, Prefix=prefix, **({"ContinuationToken": token} if token else {}))
        keys += [o["Key"] for o in r.get("Contents", [])]
        if not r.get("IsTruncated"):
            return keys
        token = r["NextContinuationToken"]


def company_of(entry):
    m = entry[2] if len(entry) > 2 else None
    if not m:
        return None
    return m.get("cid") or (m.get("id") if m.get("t") == "company" else None)


def load(dirname):
    out = {}
    for f in os.listdir(dirname):
        if f.endswith(".json"):
            for code, entry in json.load(open(os.path.join(dirname, f))).items():
                out[code] = company_of(entry)
    return out


def diff():
    s3 = client()
    os.makedirs(LIVE_CACHE, exist_ok=True)
    keys = list_keys(s3, "offidx/")
    with ThreadPoolExecutor(16) as ex:
        list(ex.map(lambda k: s3.download_file(BUCKET, k, os.path.join(LIVE_CACHE, os.path.basename(k))), keys))
    live, new = load(LIVE_CACHE), load(os.path.join(OUT, "offidx"))
    for label, d in (("live", live), ("new", new)):
        named = sum(1 for v in d.values() if v)
        print(f"{label:4}: {len(d):,} barcodes, {named:,} name a company ({named / len(d):.1%})")
    common = live.keys() & new.keys()
    gained = sum(1 for k in common if new[k] and not live[k])
    lost = [k for k in common if live[k] and not new[k]]
    moved = [(k, live[k], new[k]) for k in common if live[k] and new[k] and live[k] != new[k]]
    print(f"barcodes in both: {gained:,} gained a company, {len(lost):,} lost one, {len(moved):,} moved")
    names = {c["id"]: c["name"] for c in json.load(open(os.path.join(OUT, "graph-match-data.json")))["companies"]}
    pairs = Counter((names.get(a, a), names.get(b, b)) for _, a, b in moved)
    print("largest moves:")
    for (a, b), n in pairs.most_common(25):
        print(f"  {n:>6}  {a}  ->  {b}")
    json.dump({"lost": lost, "moved": moved}, open(os.path.join(OUT, "diff.json"), "w"))


def backup(name):
    s3 = client()
    keys = list_keys(s3, "offidx/") + list_keys(s3, "datasets/")
    with ThreadPoolExecutor(16) as ex:
        list(ex.map(lambda k: s3.copy_object(Bucket=BACKUPS, Key=f"{name}/{k}",
                                             CopySource={"Bucket": BUCKET, "Key": k}), keys))
    print(f"backed up {len(keys)} objects to {BACKUPS}/{name}/")


def publish():
    s3 = client()
    src = os.path.join(OUT, "offidx")
    files = sorted(f for f in os.listdir(src) if f.endswith(".json"))
    with ThreadPoolExecutor(16) as ex:
        list(ex.map(lambda f: s3.upload_file(os.path.join(src, f), BUCKET, f"offidx/{f}",
                                             ExtraArgs={"ContentType": "application/json"}), files))
    s3.upload_file(os.path.join(OUT, "extract", "boyk-off-brand-extract.csv.gz"), BUCKET,
                   "datasets/boyk-off-brand-extract.csv.gz", ExtraArgs={"ContentType": "application/gzip"})
    print(f"published {len(files)} shards + extract")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "diff":
        diff()
    elif cmd == "backup" and len(sys.argv) > 2:
        backup(sys.argv[2])
    elif cmd == "publish":
        publish()
    else:
        sys.exit(__doc__)
