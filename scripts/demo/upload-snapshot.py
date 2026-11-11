#!/usr/bin/env python3
"""Upload a saved API snapshot to R2, where the demo Worker reads it.

  python3 scripts/demo/upload-snapshot.py <snapshot-dir> [--prefix api-cache] [--shard 0/4]

Every <snapshot-dir>/**/*.json becomes <prefix>/<same path> in the boyk-assets
bucket. Needs R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and CLOUDFLARE_ACCOUNT_ID
in .env. Safe to re-run: files already uploaded with the same size are skipped.
--shard i/n uploads only every n-th file, so n copies can run side by side.
"""
import os, sys, threading, zlib
from concurrent.futures import ThreadPoolExecutor
import boto3
from botocore.config import Config

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = sys.argv[1].rstrip("/")
PREFIX = sys.argv[sys.argv.index("--prefix") + 1] if "--prefix" in sys.argv else "api-cache"
BUCKET = sys.argv[sys.argv.index("--bucket") + 1] if "--bucket" in sys.argv else "boyk-assets"
SHARD, SHARDS = (
    map(int, sys.argv[sys.argv.index("--shard") + 1].split("/")) if "--shard" in sys.argv else (0, 1)
)


def env(key):
    for line in open(os.path.join(ROOT, ".env")):
        if line.startswith(key + "="):
            return line.split("=", 1)[1].strip().strip("\"'")


s3 = boto3.client(
    "s3",
    endpoint_url=f"https://{env('CLOUDFLARE_ACCOUNT_ID')}.r2.cloudflarestorage.com",
    aws_access_key_id=env("R2_ACCESS_KEY_ID"),
    aws_secret_access_key=env("R2_SECRET_ACCESS_KEY"),
    region_name="auto",
    config=Config(max_pool_connections=128, retries={"max_attempts": 8, "mode": "standard"}),
)

existing = {}
for page in s3.get_paginator("list_objects_v2").paginate(Bucket=BUCKET, Prefix=PREFIX + "/"):
    for obj in page.get("Contents", []):
        existing[obj["Key"]] = obj["Size"]
print(f"{len(existing)} objects already under {BUCKET}/{PREFIX}/", flush=True)

todo = []
for folder, _, files in os.walk(SRC):
    for name in files:
        if name.endswith((".json", ".gz")):
            path = os.path.join(folder, name)
            key = f"{PREFIX}/{os.path.relpath(path, SRC)}"
            mine = zlib.crc32(key.encode()) % SHARDS == SHARD
            if mine and existing.get(key) != os.path.getsize(path):
                todo.append((path, key))
print(f"{len(todo)} files to upload", flush=True)

done, failed, lock = 0, [], threading.Lock()


def put(item):
    global done
    path, key = item
    try:
        ctype = "application/json" if key.endswith(".json") else "application/gzip"
        with open(path, "rb") as f:
            s3.put_object(Bucket=BUCKET, Key=key, Body=f.read(), ContentType=ctype)
    except Exception as e:  # reported at the end; one bad file must not stop the rest
        with lock:
            failed.append((key, str(e)))
        return
    with lock:
        done += 1
        if done % 10000 == 0:
            print(f"{done}/{len(todo)}", flush=True)


with ThreadPoolExecutor(120) as pool:
    list(pool.map(put, todo))
print(f"uploaded {done}, failed {len(failed)}")
for key, err in failed[:20]:
    print("  FAILED", key, err)
sys.exit(1 if failed else 0)
