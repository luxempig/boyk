#!/usr/bin/env python3
"""
Wikidata Cache Builder
======================

Runs all SPARQL queries needed by the ETL pipeline, stores results as
gzipped JSON in S3. Designed to run weekly via cron, EventBridge, or Lambda.

Architecture:
    wikidata_cache_builder.py  (this script — runs weekly)
        → queries Wikidata SPARQL endpoint
        → stores results in S3 as gzipped JSON
        → writes manifest.json with timestamps + row counts

    etl_gleif_wikidata_v3.py   (ETL script — runs daily or on-demand)
        → reads cached JSON from S3 (sub-second)
        → only hits GLEIF API live (fast, cacheable separately)
        → writes to Neo4j

S3 layout:
    s3://{bucket}/wikidata-cache/
        manifest.json                    ← timestamps, row counts, status
        companies_with_lei.json.gz       ← Step 1
        companies_without_lei.json.gz    ← Step 5
        brand_ownership.json.gz          ← Step 6
        company_ownership.json.gz        ← Step 7
        founders.json.gz                 ← Step 8a
        ceos.json.gz                     ← Step 8b
        board_members.json.gz            ← Step 8c

Usage:
    # Full refresh (all queries)
    python wikidata_cache_builder.py --bucket my-boyk-data

    # Refresh specific queries only
    python wikidata_cache_builder.py --bucket my-boyk-data --only companies_with_lei,brands

    # Dry run (query Wikidata but don't upload)
    python wikidata_cache_builder.py --bucket my-boyk-data --dry-run

    # Use local directory instead of S3 (for testing)
    python wikidata_cache_builder.py --local ./cache

Environment:
    AWS_PROFILE / AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY (for S3)
"""

import os
import sys
import json
import gzip
import time
import re
import argparse
import hashlib
from pathlib import Path
from datetime import datetime, timezone
from typing import Dict, List, Optional, Any
from dataclasses import dataclass

import requests

try:
    import boto3
    HAS_BOTO3 = True
except ImportError:
    HAS_BOTO3 = False


# =============================================================================
# Configuration
# =============================================================================

S3_PREFIX = "wikidata-cache"
WIKIDATA_ENDPOINT = "https://query.wikidata.org/sparql"
RATE_LIMIT_SECONDS = 2.0  # Be generous to Wikidata — we only run weekly
MAX_RETRIES = 3


# =============================================================================
# SPARQL Queries — exactly matching what the ETL needs
# =============================================================================

QUERIES: Dict[str, str] = {
    # -------------------------------------------------------------------------
    # Step 1: All companies with an LEI code + their metadata
    # This is the seed query — everything else builds on this.
    # Properties: P1278 LEI, P856 website, P154 logo, P571 founded,
    #   P452 industry, P159 HQ, P414 exchange, P249 ticker, P5531 CIK
    # -------------------------------------------------------------------------
    "companies_with_lei": """
        SELECT ?company ?companyLabel ?lei ?website ?logo ?foundedYear
               ?industryLabel ?description ?hqLabel ?exchangeLabel ?ticker ?cik
        WHERE {
          ?company wdt:P1278 ?lei .
          OPTIONAL { ?company wdt:P856 ?website . }
          OPTIONAL { ?company wdt:P154 ?logo . }
          OPTIONAL { ?company wdt:P571 ?founded . BIND(YEAR(?founded) AS ?foundedYear) }
          OPTIONAL { ?company wdt:P452 ?industry . }
          OPTIONAL { ?company schema:description ?description . FILTER(LANG(?description) = "en") }
          OPTIONAL { ?company wdt:P159 ?hq . }
          OPTIONAL { ?company wdt:P414 ?exchange . }
          OPTIONAL { ?company wdt:P249 ?ticker . }
          OPTIONAL { ?company wdt:P5531 ?cik . }
          SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
        }
    """,

    # -------------------------------------------------------------------------
    # Step 5: Companies that participate in ownership but lack an LEI
    # These are needed so ownership edges have both endpoints in the graph.
    # -------------------------------------------------------------------------
    "companies_without_lei": """
        SELECT DISTINCT ?company ?companyLabel ?website ?logo ?industryLabel ?description
        WHERE {
          {
            ?child wdt:P127 ?company .
            ?child wdt:P31/wdt:P279* wd:Q4830453 .
          } UNION {
            ?company wdt:P127 ?parent .
          }
          ?company wdt:P31/wdt:P279* wd:Q4830453 .
          FILTER NOT EXISTS { ?company wdt:P1278 ?lei }
          OPTIONAL { ?company wdt:P856 ?website . }
          OPTIONAL { ?company wdt:P154 ?logo . }
          OPTIONAL { ?company wdt:P452 ?industry . }
          OPTIONAL { ?company schema:description ?description . FILTER(LANG(?description) = "en") }
          SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
        }
        LIMIT 50000
    """,

    # -------------------------------------------------------------------------
    # Step 6: Brands (Q431289) owned by companies, with sourced references
    # -------------------------------------------------------------------------
    "brand_ownership": """
        SELECT ?brand ?brandLabel ?brandLogo ?brandWebsite ?owner ?ownerLabel ?refUrl
        WHERE {
          ?brand wdt:P31/wdt:P279* wd:Q431289 .
          ?brand p:P127 ?stmt .
          ?stmt ps:P127 ?owner .
          ?stmt prov:wasDerivedFrom ?ref .
          ?ref pr:P854 ?refUrl .
          ?owner wdt:P31/wdt:P279* wd:Q4830453 .
          OPTIONAL { ?brand wdt:P154 ?brandLogo . }
          OPTIONAL { ?brand wdt:P856 ?brandWebsite . }
          SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
        }
        LIMIT 100000
    """,

    # -------------------------------------------------------------------------
    # Step 7: Company → owns → Company, with sourced references
    # -------------------------------------------------------------------------
    "company_ownership": """
        SELECT ?child ?childLabel ?parent ?parentLabel ?refUrl
        WHERE {
          ?child wdt:P31/wdt:P279* wd:Q4830453 .
          ?child p:P127 ?stmt .
          ?stmt ps:P127 ?parent .
          ?stmt prov:wasDerivedFrom ?ref .
          ?ref pr:P854 ?refUrl .
          ?parent wdt:P31/wdt:P279* wd:Q4830453 .
          SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
        }
        LIMIT 100000
    """,

    # -------------------------------------------------------------------------
    # Step 8a: Founders of companies (P112), humans only
    # -------------------------------------------------------------------------
    "founders": """
        SELECT ?company ?companyLabel ?founder ?founderLabel ?refUrl
        WHERE {
          ?company wdt:P31/wdt:P279* wd:Q4830453 .
          ?company p:P112 ?stmt .
          ?stmt ps:P112 ?founder .
          ?stmt prov:wasDerivedFrom ?ref .
          ?ref pr:P854 ?refUrl .
          ?founder wdt:P31 wd:Q5 .
          SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
        }
        LIMIT 50000
    """,

    # -------------------------------------------------------------------------
    # Step 8b: CEOs of companies (P169), with tenure dates
    # -------------------------------------------------------------------------
    "ceos": """
        SELECT ?company ?companyLabel ?ceo ?ceoLabel ?refUrl ?startDate ?endDate
        WHERE {
          ?company wdt:P31/wdt:P279* wd:Q4830453 .
          ?company p:P169 ?stmt .
          ?stmt ps:P169 ?ceo .
          ?stmt prov:wasDerivedFrom ?ref .
          ?ref pr:P854 ?refUrl .
          ?ceo wdt:P31 wd:Q5 .
          OPTIONAL { ?stmt pq:P580 ?startDate . }
          OPTIONAL { ?stmt pq:P582 ?endDate . }
          SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
        }
        LIMIT 50000
    """,

    # -------------------------------------------------------------------------
    # Step 8c: Board members (P3320), with tenure and role
    # -------------------------------------------------------------------------
    "board_members": """
        SELECT ?company ?companyLabel ?person ?personLabel ?roleLabel ?refUrl ?startDate ?endDate
        WHERE {
          ?company wdt:P31/wdt:P279* wd:Q4830453 .
          ?company p:P3320 ?stmt .
          ?stmt ps:P3320 ?person .
          ?stmt prov:wasDerivedFrom ?ref .
          ?ref pr:P854 ?refUrl .
          ?person wdt:P31 wd:Q5 .
          OPTIONAL { ?stmt pq:P580 ?startDate . }
          OPTIONAL { ?stmt pq:P582 ?endDate . }
          OPTIONAL { ?stmt pq:P2868 ?role . }
          SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
        }
        LIMIT 50000
    """,
}


# =============================================================================
# Wikidata fetcher (same sanitization as ETL)
# =============================================================================


def run_sparql(query_name: str, sparql: str) -> List[Dict]:
    """Execute a SPARQL query with retries and JSON control-char sanitization."""
    session = requests.Session()
    session.headers.update({
        "Accept": "application/sparql-results+json",
        "User-Agent": "BoykCacheBuilder/1.0 (https://boyk.app)",
    })

    for attempt in range(MAX_RETRIES):
        try:
            print(f"  [{query_name}] Querying Wikidata (attempt {attempt + 1})...")
            t = time.time()
            resp = session.get(
                WIKIDATA_ENDPOINT, params={"query": sparql}, timeout=300
            )
            resp.raise_for_status()
            elapsed = time.time() - t

            # Sanitize control characters (same as ETL)
            text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", resp.text)
            data = json.loads(text)
            rows = data.get("results", {}).get("bindings", [])

            print(f"  [{query_name}] {len(rows)} rows in {elapsed:.1f}s")
            time.sleep(RATE_LIMIT_SECONDS)
            return rows

        except Exception as e:
            wait = 10 * (attempt + 1)
            print(f"  [{query_name}] Error: {e}")
            if attempt < MAX_RETRIES - 1:
                print(f"  [{query_name}] Retrying in {wait}s...")
                time.sleep(wait)
            else:
                print(f"  [{query_name}] FAILED after {MAX_RETRIES} attempts")
                return []


# =============================================================================
# Storage backends (S3 or local)
# =============================================================================


class S3Storage:
    def __init__(self, bucket: str, prefix: str = S3_PREFIX):
        if not HAS_BOTO3:
            raise RuntimeError("boto3 required for S3 storage: pip install boto3")
        self.bucket = bucket
        self.prefix = prefix
        self.s3 = boto3.client("s3")

    def write_gz_json(self, key: str, data: Any):
        s3_key = f"{self.prefix}/{key}"
        body = gzip.compress(json.dumps(data, ensure_ascii=False).encode("utf-8"))
        self.s3.put_object(
            Bucket=self.bucket,
            Key=s3_key,
            Body=body,
            ContentType="application/json",
            ContentEncoding="gzip",
        )
        size_mb = len(body) / (1024 * 1024)
        print(f"  → s3://{self.bucket}/{s3_key} ({size_mb:.2f} MB)")

    def write_json(self, key: str, data: Any):
        s3_key = f"{self.prefix}/{key}"
        body = json.dumps(data, indent=2, ensure_ascii=False, default=str)
        self.s3.put_object(
            Bucket=self.bucket,
            Key=s3_key,
            Body=body.encode("utf-8"),
            ContentType="application/json",
        )

    def read_json(self, key: str) -> Optional[Any]:
        try:
            resp = self.s3.get_object(Bucket=self.bucket, Key=f"{self.prefix}/{key}")
            return json.loads(resp["Body"].read().decode("utf-8"))
        except Exception:
            return None


class LocalStorage:
    def __init__(self, directory: str):
        self.base = Path(directory)
        self.base.mkdir(parents=True, exist_ok=True)

    def write_gz_json(self, key: str, data: Any):
        path = self.base / key
        path.parent.mkdir(parents=True, exist_ok=True)
        with gzip.open(path, "wt", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
        size_mb = path.stat().st_size / (1024 * 1024)
        print(f"  → {path} ({size_mb:.2f} MB)")

    def write_json(self, key: str, data: Any):
        path = self.base / key
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w") as f:
            json.dump(data, f, indent=2, ensure_ascii=False, default=str)

    def read_json(self, key: str) -> Optional[Any]:
        path = self.base / key
        if not path.exists():
            return None
        with open(path) as f:
            return json.load(f)


# =============================================================================
# Cache builder
# =============================================================================


def build_cache(
    storage,
    only: Optional[List[str]] = None,
    dry_run: bool = False,
):
    """Run all (or selected) SPARQL queries and store results."""

    queries_to_run = {k: v for k, v in QUERIES.items() if not only or k in only}

    if not queries_to_run:
        print(f"No matching queries. Available: {list(QUERIES.keys())}")
        return

    # Load existing manifest (if any)
    manifest = storage.read_json("manifest.json") or {"queries": {}}
    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")

    print("=" * 60)
    print(f"Wikidata Cache Builder — {run_id}")
    print(f"  Queries: {list(queries_to_run.keys())}")
    print(f"  Dry run: {dry_run}")
    print("=" * 60)

    total_start = time.time()

    for name, sparql in queries_to_run.items():
        print(f"\n--- {name} ---")
        rows = run_sparql(name, sparql)

        if not rows:
            print(f"  [{name}] No data returned, skipping upload")
            continue

        filename = f"{name}.json.gz"

        # Compute content hash for change detection
        content_hash = hashlib.md5(
            json.dumps(rows, sort_keys=True).encode()
        ).hexdigest()[:12]

        prev = manifest["queries"].get(name, {})
        changed = prev.get("content_hash") != content_hash

        if not dry_run:
            storage.write_gz_json(filename, rows)

        manifest["queries"][name] = {
            "filename": filename,
            "rows": len(rows),
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "content_hash": content_hash,
            "changed_from_previous": changed,
            "run_id": run_id,
        }

    # Write manifest
    manifest["last_run"] = run_id
    manifest["last_run_at"] = datetime.now(timezone.utc).isoformat()
    manifest["total_seconds"] = round(time.time() - total_start, 1)

    if not dry_run:
        storage.write_json("manifest.json", manifest)
        print(f"\n  → manifest.json updated")

    # Summary
    print(f"\n{'=' * 60}")
    print(f"Cache build complete in {manifest['total_seconds']}s")
    print(f"{'=' * 60}")
    for name, info in manifest["queries"].items():
        status = "CHANGED" if info.get("changed_from_previous") else "unchanged"
        print(f"  {name:30} {info['rows']:>8,} rows  [{status}]")


# =============================================================================
# Main
# =============================================================================


def main():
    parser = argparse.ArgumentParser(
        description="Build Wikidata cache for Boyk ETL pipeline"
    )
    parser.add_argument(
        "--bucket", type=str, help="S3 bucket name"
    )
    parser.add_argument(
        "--local", type=str, help="Local directory (alternative to S3)"
    )
    parser.add_argument(
        "--only",
        type=str,
        help="Comma-separated query names to refresh (default: all)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Query Wikidata but don't upload results",
    )
    parser.add_argument(
        "--list-queries",
        action="store_true",
        help="List available query names",
    )

    args = parser.parse_args()

    if args.list_queries:
        print("Available queries:")
        for name in QUERIES:
            print(f"  {name}")
        return

    if not args.bucket and not args.local:
        parser.error("Must specify --bucket or --local")

    storage = (
        S3Storage(args.bucket) if args.bucket else LocalStorage(args.local)
    )
    only = args.only.split(",") if args.only else None

    build_cache(storage, only=only, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
