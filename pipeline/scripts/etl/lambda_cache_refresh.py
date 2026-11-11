#!/usr/bin/env python3
"""
Lambda handler for weekly Wikidata cache refresh.

Deploy as a Lambda function triggered by EventBridge (weekly schedule).
Runs all SPARQL queries and stores results in S3.

Lambda config:
  - Runtime: Python 3.12
  - Memory: 512 MB
  - Timeout: 15 minutes (max)
  - Layers: requests (or bundle in zip)
  - Environment: CACHE_BUCKET=my-boyk-data

Trigger:
  - EventBridge rule: rate(7 days) or cron(0 3 ? * SUN *)
"""

import os
import json
import gzip
import time
import hashlib
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from typing import Dict, List, Optional, Any

import requests
import boto3


S3_PREFIX = "wikidata-cache"
WIKIDATA_ENDPOINT = "https://query.wikidata.org/sparql"
RATE_LIMIT = 2.0
MAX_RETRIES = 3
PAGE_SIZE = 10000  # Batch size for paginated queries (smaller = more reliable)
SPARQL_NS = {"s": "http://www.w3.org/2005/sparql-results#"}

# Same queries as wikidata_cache_builder.py
QUERIES: Dict[str, str] = {
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
    # NOTE: companies_without_lei removed - those nodes are derived from
    # company_ownership + brand_ownership at ETL time (they appear as
    # child/parent/owner in relationships and get MERGEd inline)
    "brand_ownership": """
        SELECT ?brand ?brandLabel ?brandLogo ?brandWebsite ?owner ?ownerLabel ?refUrl
        WHERE {
          ?brand wdt:P31/wdt:P279* wd:Q431289 .
          ?brand p:P127 ?stmt . ?stmt ps:P127 ?owner .
          ?stmt prov:wasDerivedFrom ?ref . ?ref pr:P854 ?refUrl .
          ?owner wdt:P31/wdt:P279* wd:Q4830453 .
          OPTIONAL { ?brand wdt:P154 ?brandLogo . }
          OPTIONAL { ?brand wdt:P856 ?brandWebsite . }
          SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
        }
        LIMIT 100000
    """,
    "founders": """
        SELECT ?company ?companyLabel ?founder ?founderLabel ?refUrl
        WHERE {
          ?company wdt:P31/wdt:P279* wd:Q4830453 .
          ?company p:P112 ?stmt . ?stmt ps:P112 ?founder .
          ?stmt prov:wasDerivedFrom ?ref . ?ref pr:P854 ?refUrl .
          ?founder wdt:P31 wd:Q5 .
          SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
        }
        LIMIT 50000
    """,
    "ceos": """
        SELECT ?company ?companyLabel ?ceo ?ceoLabel ?refUrl ?startDate ?endDate
        WHERE {
          ?company wdt:P31/wdt:P279* wd:Q4830453 .
          ?company p:P169 ?stmt . ?stmt ps:P169 ?ceo .
          ?stmt prov:wasDerivedFrom ?ref . ?ref pr:P854 ?refUrl .
          ?ceo wdt:P31 wd:Q5 .
          OPTIONAL { ?stmt pq:P580 ?startDate . }
          OPTIONAL { ?stmt pq:P582 ?endDate . }
          SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
        }
        LIMIT 50000
    """,
    "board_members": """
        SELECT ?company ?companyLabel ?person ?personLabel ?roleLabel ?refUrl ?startDate ?endDate
        WHERE {
          ?company wdt:P31/wdt:P279* wd:Q4830453 .
          ?company p:P3320 ?stmt . ?stmt ps:P3320 ?person .
          ?stmt prov:wasDerivedFrom ?ref . ?ref pr:P854 ?refUrl .
          ?person wdt:P31 wd:Q5 .
          OPTIONAL { ?stmt pq:P580 ?startDate . }
          OPTIONAL { ?stmt pq:P582 ?endDate . }
          OPTIONAL { ?stmt pq:P2868 ?role . }
          SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
        }
        LIMIT 50000
    """,
}

# Queries that need pagination (no LIMIT in base query)
PAGINATED_QUERIES: Dict[str, str] = {
    "company_ownership": """
        SELECT ?child ?childLabel ?parent ?parentLabel ?refUrl
        WHERE {
          ?child wdt:P31/wdt:P279* wd:Q4830453 .
          ?child p:P127 ?stmt . ?stmt ps:P127 ?parent .
          ?stmt prov:wasDerivedFrom ?ref . ?ref pr:P854 ?refUrl .
          ?parent wdt:P31/wdt:P279* wd:Q4830453 .
          SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
        }
    """,
}


def parse_sparql_xml(content: bytes) -> List[Dict]:
    """Parse SPARQL XML results into list of dicts (matching JSON bindings format)."""
    root = ET.fromstring(content)
    rows = []
    for result in root.findall(".//s:result", SPARQL_NS):
        row = {}
        for binding in result.findall("s:binding", SPARQL_NS):
            name = binding.attrib["name"]
            value_el = binding[0]  # <uri>, <literal>, <bnode>
            # Match JSON format: {"type": "uri/literal", "value": "..."}
            row[name] = {"type": value_el.tag.split("}")[-1], "value": value_el.text or ""}
        rows.append(row)
    return rows


def run_sparql(name: str, sparql: str) -> List[Dict]:
    """Run SPARQL query using XML format (more reliable than JSON for large results)."""
    session = requests.Session()
    session.headers.update({
        "Accept": "application/sparql-results+xml",
        "User-Agent": "BoykCacheBuilder/1.0 (https://boyk.app)",
    })
    for attempt in range(MAX_RETRIES):
        try:
            resp = session.get(WIKIDATA_ENDPOINT, params={"query": sparql}, timeout=300)
            resp.raise_for_status()
            rows = parse_sparql_xml(resp.content)
            print(f"  [{name}] {len(rows)} rows")
            time.sleep(RATE_LIMIT)
            return rows
        except Exception as e:
            print(f"  [{name}] Error (attempt {attempt+1}): {e}")
            if attempt < MAX_RETRIES - 1:
                time.sleep(10 * (attempt + 1))
    return []


def run_paginated_sparql(name: str, base_sparql: str, page_size: int = PAGE_SIZE) -> List[Dict]:
    """Fetch all results using OFFSET/LIMIT pagination."""
    all_rows = []
    offset = 0
    page = 1

    while True:
        paginated_query = f"{base_sparql} LIMIT {page_size} OFFSET {offset}"
        print(f"  [{name}] Fetching page {page} (offset {offset})...")

        rows = run_sparql(f"{name}_p{page}", paginated_query)

        if not rows:
            if page == 1:
                print(f"  [{name}] No results on first page, query may have failed")
                return []
            break

        all_rows.extend(rows)
        print(f"  [{name}] Page {page}: {len(rows)} rows (total: {len(all_rows)})")

        # If we got fewer than page_size, we've reached the end
        if len(rows) < page_size:
            break

        offset += page_size
        page += 1

        # Safety limit: max 10 pages (500K rows)
        if page > 10:
            print(f"  [{name}] Hit page limit, stopping at {len(all_rows)} rows")
            break

    print(f"  [{name}] Total: {len(all_rows)} rows across {page} pages")
    return all_rows


def lambda_handler(event, context):
    bucket = os.environ.get("CACHE_BUCKET")
    if not bucket:
        raise ValueError("CACHE_BUCKET env var required")

    s3 = boto3.client("s3")
    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")

    # Load existing manifest
    try:
        resp = s3.get_object(Bucket=bucket, Key=f"{S3_PREFIX}/manifest.json")
        manifest = json.loads(resp["Body"].read())
    except Exception:
        manifest = {"queries": {}}

    total_start = time.time()
    results_summary = {}

    # Process regular queries
    for name, sparql in QUERIES.items():
        rows = run_sparql(name, sparql)
        if not rows:
            results_summary[name] = {"status": "FAILED", "rows": 0}
            continue

        # Upload gzipped JSON
        body = gzip.compress(json.dumps(rows, ensure_ascii=False).encode("utf-8"))
        s3.put_object(
            Bucket=bucket,
            Key=f"{S3_PREFIX}/{name}.json.gz",
            Body=body,
            ContentType="application/json",
            ContentEncoding="gzip",
        )

        content_hash = hashlib.md5(
            json.dumps(rows, sort_keys=True).encode()
        ).hexdigest()[:12]

        prev = manifest["queries"].get(name, {})
        changed = prev.get("content_hash") != content_hash

        manifest["queries"][name] = {
            "filename": f"{name}.json.gz",
            "rows": len(rows),
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "content_hash": content_hash,
            "changed_from_previous": changed,
            "run_id": run_id,
        }

        results_summary[name] = {
            "status": "CHANGED" if changed else "UNCHANGED",
            "rows": len(rows),
        }

    # Process paginated queries
    for name, sparql in PAGINATED_QUERIES.items():
        rows = run_paginated_sparql(name, sparql)
        if not rows:
            results_summary[name] = {"status": "FAILED", "rows": 0}
            continue

        # Upload gzipped JSON
        body = gzip.compress(json.dumps(rows, ensure_ascii=False).encode("utf-8"))
        s3.put_object(
            Bucket=bucket,
            Key=f"{S3_PREFIX}/{name}.json.gz",
            Body=body,
            ContentType="application/json",
            ContentEncoding="gzip",
        )

        content_hash = hashlib.md5(
            json.dumps(rows, sort_keys=True).encode()
        ).hexdigest()[:12]

        prev = manifest["queries"].get(name, {})
        changed = prev.get("content_hash") != content_hash

        manifest["queries"][name] = {
            "filename": f"{name}.json.gz",
            "rows": len(rows),
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "content_hash": content_hash,
            "changed_from_previous": changed,
            "run_id": run_id,
        }

        results_summary[name] = {
            "status": "CHANGED" if changed else "UNCHANGED",
            "rows": len(rows),
        }

    # Update manifest
    manifest["last_run"] = run_id
    manifest["last_run_at"] = datetime.now(timezone.utc).isoformat()
    manifest["total_seconds"] = round(time.time() - total_start, 1)

    s3.put_object(
        Bucket=bucket,
        Key=f"{S3_PREFIX}/manifest.json",
        Body=json.dumps(manifest, indent=2, default=str).encode("utf-8"),
        ContentType="application/json",
    )

    print(f"Cache refresh complete in {manifest['total_seconds']}s")
    return {
        "statusCode": 200,
        "run_id": run_id,
        "duration_seconds": manifest["total_seconds"],
        "queries": results_summary,
    }


# Allow running locally too
if __name__ == "__main__":
    import sys
    os.environ.setdefault("CACHE_BUCKET", sys.argv[1] if len(sys.argv) > 1 else "")
    result = lambda_handler({}, None)
    print(json.dumps(result, indent=2))
