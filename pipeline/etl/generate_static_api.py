#!/usr/bin/env python3
"""
Generate static JSON API responses and upload to R2.
Runs after ETL completes. Processes one entity type per invocation.

Usage:
    python generate_static_api.py --type companies
    python generate_static_api.py --type brands
    python generate_static_api.py --type stats
"""

import argparse
import json
import logging
import os
import time

import boto3
from neo4j import GraphDatabase

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("static-api")

NEO4J_URI = os.environ.get("NEO4J_URI", "neo4j+s://c3943731.databases.neo4j.io")
NEO4J_USER = os.environ.get("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.environ["NEO4J_PASSWORD"]

R2_ENDPOINT = os.environ.get(
    "R2_ENDPOINT",
    f"https://{os.environ.get('R2_ACCOUNT_ID', '')}.r2.cloudflarestorage.com",
)
R2_BUCKET = os.environ.get("R2_BUCKET", "boyk-assets")
R2_PREFIX = "api-cache"

driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))
s3 = boto3.client(
    "s3",
    endpoint_url=R2_ENDPOINT,
    aws_access_key_id=os.environ.get("R2_ACCESS_KEY_ID"),
    aws_secret_access_key=os.environ.get("R2_SECRET_ACCESS_KEY"),
    region_name="auto",
)


def upload_json(key, data):
    """Upload a JSON object to R2."""
    s3.put_object(
        Bucket=R2_BUCKET,
        Key=f"{R2_PREFIX}/{key}",
        Body=json.dumps(data, default=str),
        ContentType="application/json",
    )


def run_query(cypher, params=None):
    """Run a Cypher query and return list of dicts."""
    with driver.session() as session:
        result = session.run(cypher, params or {})
        return [dict(record) for record in result]


def generate_stats():
    """Generate stats.json."""
    rows = run_query(
        """
        CALL {
            MATCH (c:Company) RETURN 'Company' AS label, count(c) AS count
            UNION ALL
            MATCH (b:Brand) RETURN 'Brand' AS label, count(b) AS count
            UNION ALL
            MATCH (p:Product) RETURN 'Product' AS label, count(p) AS count
            UNION ALL
            MATCH (p:Person) RETURN 'Person' AS label, count(p) AS count
        }
        RETURN label, count
    """
    )
    stats = {r["label"]: r["count"] for r in rows}
    upload_json("stats.json", stats)
    logger.info(f"Uploaded stats.json: {stats}")
    return 1


def generate_companies():
    """Generate JSON for all companies in batches."""
    ids = run_query(
        """
        MATCH (c:Company)
        RETURN coalesce(c.lei, c.wikidata_id) AS id
    """
    )
    logger.info(f"Generating JSON for {len(ids)} companies")

    count = 0
    for batch_start in range(0, len(ids), 100):
        batch = ids[batch_start : batch_start + 100]
        batch_ids = [r["id"] for r in batch if r["id"]]

        for company_id in batch_ids:
            try:
                rows = run_query(
                    """
                    MATCH (c:Company)
                    WHERE c.lei = $id OR c.wikidata_id = $id
                    RETURN properties(c) AS props
                """,
                    {"id": company_id},
                )

                if rows:
                    data = dict(rows[0]["props"])
                    data["id"] = company_id
                    upload_json(f"companies/{company_id}.json", data)
                    count += 1
            except Exception as e:
                logger.warning(f"Failed to generate {company_id}: {e}")

        if batch_start % 1000 == 0 and batch_start > 0:
            logger.info(f"Progress: {batch_start}/{len(ids)} companies")

    logger.info(f"Generated {count} company JSON files")
    return count


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--type", required=True, choices=["companies", "brands", "stats"])
    args = parser.parse_args()

    start = time.time()

    if args.type == "stats":
        count = generate_stats()
    elif args.type == "companies":
        count = generate_companies()
    elif args.type == "brands":
        count = 0
        logger.info("Brand generation not yet implemented")

    elapsed = time.time() - start
    logger.info(f"Completed {args.type}: {count} files in {elapsed:.1f}s")
    driver.close()


if __name__ == "__main__":
    main()
