#!/usr/bin/env python3
"""
ETL Pipeline v3: Cached Wikidata + GLEIF API → Neo4j
=====================================================

Reads pre-cached Wikidata SPARQL results from S3 or local disk.
Only the GLEIF API is queried live. Wikidata cache is built separately
by wikidata_cache_builder.py (runs weekly).

This means:
  - Wikidata portion: ~0.5s (download + decompress from S3) vs ~5-10min live
  - GLEIF API: still live, but independently cacheable
  - Total ETL: dominated by GLEIF API + Neo4j writes (~1-3 min)

Usage:
    # Run using S3 cache
    python etl_gleif_wikidata_v3.py --run --cache-bucket my-boyk-data

    # Run using local cache (for dev/testing)
    python etl_gleif_wikidata_v3.py --run --cache-local ./cache

    # Stats / clear (same as before)
    python etl_gleif_wikidata_v3.py --stats
    python etl_gleif_wikidata_v3.py --clear

Environment:
    NEO4J_URI=bolt://localhost:7687
    NEO4J_USERNAME=neo4j
    NEO4J_PASSWORD=password
    AWS_PROFILE (if using S3)
"""

import os
import sys
import argparse
import uuid
import time
import json
import gzip
import re
import gc
import threading
import queue
import traceback
import requests
import multiprocessing as mp
from pathlib import Path
from datetime import datetime
from typing import Optional, Dict, List, Set, Any, Tuple
from dataclasses import dataclass, field, asdict
from concurrent.futures import ThreadPoolExecutor, as_completed

from neo4j import GraphDatabase, Driver

try:
    import boto3
    HAS_BOTO3 = True
except ImportError:
    HAS_BOTO3 = False


CPU_COUNT = min(mp.cpu_count(), 32)
S3_PREFIX = "wikidata-cache"


# =============================================================================
# Configuration
# =============================================================================


@dataclass
class Config:
    neo4j_uri: str = os.getenv("NEO4J_URI", "bolt://localhost:7687")
    neo4j_username: str = os.getenv("NEO4J_USERNAME", "neo4j")
    neo4j_password: str = os.getenv("NEO4J_PASSWORD", "password")
    neo4j_database: str = os.getenv("NEO4J_DATABASE", "neo4j")
    data_dir: Path = Path("./data")

    batch_size: int = 5000
    gleif_api_workers: int = 8
    neo4j_write_workers: int = 4
    neo4j_max_connection_pool_size: int = 50
    neo4j_connection_acquisition_timeout: int = 60
    gleif_api_batch_size: int = 200
    gleif_api_rate_limit: float = 0.05

    # Cache source (set by CLI args)
    cache_bucket: Optional[str] = None
    cache_local: Optional[str] = None


# =============================================================================
# Data Models
# =============================================================================


@dataclass
class Company:
    name: str
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    lei: Optional[str] = None
    wikidata_id: Optional[str] = None
    legal_name: Optional[str] = None
    cik: Optional[str] = None
    jurisdiction: Optional[str] = None
    headquarters: Optional[str] = None
    website: Optional[str] = None
    logo_url: Optional[str] = None
    description: Optional[str] = None
    founded_year: Optional[int] = None
    industry: Optional[str] = None
    stock_exchange: Optional[str] = None
    ticker: Optional[str] = None
    data_sources: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict:
        return asdict(self)


@dataclass
class Brand:
    name: str
    wikidata_id: str
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    logo_url: Optional[str] = None
    website: Optional[str] = None
    data_sources: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict:
        return asdict(self)


@dataclass
class Person:
    name: str
    wikidata_id: str
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    data_sources: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict:
        return asdict(self)


# =============================================================================
# Wikidata Cache Reader
# =============================================================================


class WikidataCache:
    """Reads pre-built Wikidata SPARQL results from S3 or local disk."""

    def __init__(self, config: Config):
        if config.cache_bucket:
            if not HAS_BOTO3:
                raise RuntimeError("boto3 required: pip install boto3")
            self._mode = "s3"
            self._bucket = config.cache_bucket
            self._s3 = boto3.client("s3")
        elif config.cache_local:
            self._mode = "local"
            self._base = Path(config.cache_local)
        else:
            raise ValueError("Must set cache_bucket or cache_local in config")

    def load(self, query_name: str) -> List[Dict]:
        """Load cached SPARQL results for a given query name."""
        filename = f"{query_name}.json.gz"
        t = time.time()

        if self._mode == "s3":
            rows = self._load_s3(filename)
        else:
            rows = self._load_local(filename)

        elapsed = time.time() - t
        print(f"  [{query_name}] Loaded {len(rows)} rows from cache ({elapsed:.2f}s)")
        return rows

    def _load_s3(self, filename: str) -> List[Dict]:
        key = f"{S3_PREFIX}/{filename}"
        try:
            resp = self._s3.get_object(Bucket=self._bucket, Key=key)
            raw = resp["Body"].read()
            text = gzip.decompress(raw).decode("utf-8")
            return json.loads(text)
        except Exception as e:
            print(f"  Warning: Failed to load s3://{self._bucket}/{key}: {e}")
            return []

    def _load_local(self, filename: str) -> List[Dict]:
        path = self._base / filename
        if not path.exists():
            print(f"  Warning: Cache file not found: {path}")
            return []
        with gzip.open(path, "rt", encoding="utf-8") as f:
            return json.load(f)

    def get_manifest(self) -> Optional[Dict]:
        """Load the manifest to check cache freshness."""
        if self._mode == "s3":
            try:
                resp = self._s3.get_object(
                    Bucket=self._bucket, Key=f"{S3_PREFIX}/manifest.json"
                )
                return json.loads(resp["Body"].read().decode("utf-8"))
            except Exception:
                return None
        else:
            path = self._base / "manifest.json"
            if not path.exists():
                return None
            with open(path) as f:
                return json.load(f)

    @staticmethod
    def extract_qid(url: str) -> Optional[str]:
        if url and "/Q" in url:
            return url.split("/")[-1]
        return None

    @staticmethod
    def val(row: Dict, key: str) -> Optional[str]:
        return row.get(key, {}).get("value") if row.get(key) else None


# =============================================================================
# Neo4j Writer (same as v2 — split ON CREATE/ON MATCH, combined queries)
# =============================================================================


class Neo4jWriter:
    def __init__(self, config: Config):
        self.config = config
        self.driver: Driver = GraphDatabase.driver(
            config.neo4j_uri,
            auth=(config.neo4j_username, config.neo4j_password),
            max_connection_pool_size=config.neo4j_max_connection_pool_size,
            connection_acquisition_timeout=config.neo4j_connection_acquisition_timeout,
        )
        self._ensure_constraints()

    def close(self):
        self.driver.close()

    def _ensure_constraints(self):
        stmts = [
            "CREATE CONSTRAINT company_id IF NOT EXISTS FOR (c:Company) REQUIRE c.id IS UNIQUE",
            "CREATE CONSTRAINT company_lei IF NOT EXISTS FOR (c:Company) REQUIRE c.lei IS UNIQUE",
            "CREATE CONSTRAINT company_wikidata IF NOT EXISTS FOR (c:Company) REQUIRE c.wikidata_id IS UNIQUE",
            "CREATE CONSTRAINT brand_id IF NOT EXISTS FOR (b:Brand) REQUIRE b.id IS UNIQUE",
            "CREATE CONSTRAINT brand_wikidata IF NOT EXISTS FOR (b:Brand) REQUIRE b.wikidata_id IS UNIQUE",
            "CREATE CONSTRAINT person_id IF NOT EXISTS FOR (p:Person) REQUIRE p.id IS UNIQUE",
            "CREATE CONSTRAINT person_wikidata IF NOT EXISTS FOR (p:Person) REQUIRE p.wikidata_id IS UNIQUE",
            "CREATE INDEX company_lei_idx IF NOT EXISTS FOR (c:Company) ON (c.lei)",
            "CREATE INDEX company_wikidata_idx IF NOT EXISTS FOR (c:Company) ON (c.wikidata_id)",
            "CREATE INDEX brand_wikidata_idx IF NOT EXISTS FOR (b:Brand) ON (b.wikidata_id)",
            "CREATE INDEX person_wikidata_idx IF NOT EXISTS FOR (p:Person) ON (p.wikidata_id)",
        ]
        with self.driver.session(database=self.config.neo4j_database) as session:
            for stmt in stmts:
                try:
                    session.run(stmt)
                except Exception as e:
                    if "already exists" not in str(e).lower():
                        print(f"Warning: {e}")
        time.sleep(1)

        self.driver.close()
        self.driver = GraphDatabase.driver(
            self.config.neo4j_uri,
            auth=(self.config.neo4j_username, self.config.neo4j_password),
            max_connection_pool_size=self.config.neo4j_max_connection_pool_size,
            connection_acquisition_timeout=self.config.neo4j_connection_acquisition_timeout,
        )

    def clear_database(self):
        with self.driver.session(database=self.config.neo4j_database) as session:
            while True:
                result = session.run(
                    "MATCH (n) WITH n LIMIT 50000 DETACH DELETE n RETURN count(*) as deleted"
                )
                deleted = result.single()["deleted"]
                if deleted == 0:
                    break
                print(f"  Deleted {deleted} nodes...")
        print("Database cleared.")

    def _run_batch_query(
        self, query: str, batch: List[Dict], param_name: str = "batch"
    ) -> int:
        if not batch:
            return 0
        with self.driver.session(database=self.config.neo4j_database) as session:
            def _tx(tx):
                result = tx.run(query, **{param_name: batch})
                record = result.single()
                return record["cnt"] if record else 0
            return session.execute_write(_tx)

    def _run_chunked_batch(
        self, query: str, items: List[Dict], param_name: str = "batch"
    ) -> int:
        if not items:
            return 0
        chunks = [
            items[i : i + self.config.batch_size]
            for i in range(0, len(items), self.config.batch_size)
        ]
        total = 0
        if len(chunks) > 4:
            with ThreadPoolExecutor(max_workers=self.config.neo4j_write_workers) as pool:
                futures = [
                    pool.submit(self._run_batch_query, query, chunk, param_name)
                    for chunk in chunks
                ]
                for f in as_completed(futures):
                    total += f.result()
        else:
            for chunk in chunks:
                total += self._run_batch_query(query, chunk, param_name)
        return total

    def merge_companies_batch(self, companies: List[Company], merge_field: str = "lei") -> int:
        query = f"""
        UNWIND $batch AS row
        MERGE (c:Company {{{merge_field}: row.{merge_field}}})
        ON CREATE SET
            c.id = row.id, c.created_at = datetime(),
            c.name = row.name, c.legal_name = row.legal_name,
            c.lei = row.lei, c.wikidata_id = row.wikidata_id,
            c.cik = row.cik, c.jurisdiction = row.jurisdiction,
            c.headquarters = row.headquarters, c.website = row.website,
            c.logo_url = row.logo_url, c.description = row.description,
            c.founded_year = row.founded_year, c.industry = row.industry,
            c.stock_exchange = row.stock_exchange, c.ticker = row.ticker,
            c.data_sources = row.data_sources
        ON MATCH SET
            c.updated_at = datetime(),
            c.name = COALESCE(row.name, c.name),
            c.legal_name = COALESCE(row.legal_name, c.legal_name),
            c.lei = COALESCE(row.lei, c.lei),
            c.wikidata_id = COALESCE(row.wikidata_id, c.wikidata_id),
            c.cik = COALESCE(row.cik, c.cik),
            c.jurisdiction = COALESCE(row.jurisdiction, c.jurisdiction),
            c.headquarters = COALESCE(row.headquarters, c.headquarters),
            c.website = COALESCE(row.website, c.website),
            c.logo_url = COALESCE(row.logo_url, c.logo_url),
            c.description = COALESCE(row.description, c.description),
            c.founded_year = COALESCE(row.founded_year, c.founded_year),
            c.industry = COALESCE(row.industry, c.industry),
            c.stock_exchange = COALESCE(row.stock_exchange, c.stock_exchange),
            c.ticker = COALESCE(row.ticker, c.ticker),
            c.data_sources = CASE
                WHEN c.data_sources IS NULL THEN row.data_sources
                ELSE [x IN c.data_sources WHERE NOT x IN row.data_sources] + row.data_sources
            END
        RETURN count(*) AS cnt
        """
        return self._run_chunked_batch(query, [c.to_dict() for c in companies])

    def create_ownership_batch_by_lei(self, relationships: List[Dict]) -> int:
        query = """
        UNWIND $rels AS rel
        MATCH (child:Company {lei: rel.child_lei})
        MATCH (parent:Company {lei: rel.parent_lei})
        MERGE (child)-[r:OWNED_BY]->(parent)
        SET r.source_url = rel.source_url, r.source = rel.source,
            r.percentage = rel.percentage, r.updated_at = datetime()
        RETURN count(r) AS cnt
        """
        return self._run_chunked_batch(query, relationships, param_name="rels")

    def merge_brands_and_ownership(self, rows: List[Dict]) -> int:
        if not rows:
            return 0
        query = """
        UNWIND $batch AS row
        MERGE (b:Brand {wikidata_id: row.brand_qid})
        ON CREATE SET
            b.id = row.brand_id, b.created_at = datetime(),
            b.name = row.brand_name, b.logo_url = row.brand_logo,
            b.website = row.brand_website, b.data_sources = ['wikidata']
        ON MATCH SET
            b.updated_at = datetime(),
            b.name = COALESCE(row.brand_name, b.name),
            b.logo_url = COALESCE(row.brand_logo, b.logo_url),
            b.website = COALESCE(row.brand_website, b.website)
        MERGE (c:Company {wikidata_id: row.company_qid})
        ON CREATE SET
            c.id = row.company_id, c.created_at = datetime(),
            c.name = row.company_name, c.data_sources = ['wikidata']
        ON MATCH SET c.updated_at = datetime()
        MERGE (b)-[r:OWNED_BY]->(c)
        SET r.source_url = row.source_url, r.source = row.source, r.updated_at = datetime()
        RETURN count(r) AS cnt
        """
        return self._run_chunked_batch(query, rows)

    def merge_company_ownership(self, rows: List[Dict]) -> int:
        if not rows:
            return 0
        query = """
        UNWIND $batch AS row
        MERGE (child:Company {wikidata_id: row.child_qid})
        ON CREATE SET
            child.id = row.child_id, child.created_at = datetime(),
            child.name = row.child_name, child.data_sources = ['wikidata']
        ON MATCH SET child.updated_at = datetime()
        MERGE (parent:Company {wikidata_id: row.parent_qid})
        ON CREATE SET
            parent.id = row.parent_id, parent.created_at = datetime(),
            parent.name = row.parent_name, parent.data_sources = ['wikidata']
        ON MATCH SET parent.updated_at = datetime()
        MERGE (child)-[r:OWNED_BY]->(parent)
        SET r.source_url = row.source_url, r.source = row.source, r.updated_at = datetime()
        RETURN count(r) AS cnt
        """
        return self._run_chunked_batch(query, rows)

    def merge_persons_and_relationships(self, rows: List[Dict], rel_type: str) -> int:
        if not rows or rel_type not in ("FOUNDER", "CEO", "BOARD_MEMBER"):
            return 0
        query = f"""
        UNWIND $batch AS row
        MERGE (p:Person {{wikidata_id: row.person_qid}})
        ON CREATE SET
            p.id = row.person_id, p.created_at = datetime(),
            p.name = row.person_name, p.data_sources = ['wikidata']
        ON MATCH SET p.updated_at = datetime()
        MERGE (c:Company {{wikidata_id: row.company_qid}})
        ON CREATE SET
            c.id = row.company_id, c.created_at = datetime(),
            c.name = row.company_name, c.data_sources = ['wikidata']
        ON MATCH SET c.updated_at = datetime()
        MERGE (p)-[r:{rel_type}]->(c)
        SET r.source_url = row.source_url, r.source = row.source,
            r.role = row.role, r.start_date = row.start_date,
            r.end_date = row.end_date, r.updated_at = datetime()
        RETURN count(r) AS cnt
        """
        return self._run_chunked_batch(query, rows)

    def get_stats(self) -> Dict[str, int]:
        query = """
        CALL {
            MATCH (c:Company) RETURN 'Company' AS label, count(c) AS count
            UNION ALL
            MATCH (b:Brand) RETURN 'Brand' AS label, count(b) AS count
            UNION ALL
            MATCH (p:Person) RETURN 'Person' AS label, count(p) AS count
            UNION ALL
            MATCH (:Company)-[r:OWNED_BY]->(:Company) RETURN 'OWNED_BY (Company→Company)' AS label, count(r) AS count
            UNION ALL
            MATCH (:Brand)-[r:OWNED_BY]->(:Company) RETURN 'OWNED_BY (Brand→Company)' AS label, count(r) AS count
            UNION ALL
            MATCH ()-[r:FOUNDER]->() RETURN 'FOUNDER' AS label, count(r) AS count
            UNION ALL
            MATCH ()-[r:CEO]->() RETURN 'CEO' AS label, count(r) AS count
            UNION ALL
            MATCH ()-[r:BOARD_MEMBER]->() RETURN 'BOARD_MEMBER' AS label, count(r) AS count
        }
        RETURN label, count ORDER BY label
        """
        with self.driver.session(database=self.config.neo4j_database) as session:
            result = session.run(query)
            return {r["label"]: r["count"] for r in result}


# =============================================================================
# GLEIF API Client (same as v2)
# =============================================================================


class GleifApiClient:
    BASE_URL = "https://api.gleif.org/api/v1/lei-records"

    def __init__(self, config: Config):
        self.config = config
        self._session = requests.Session()
        adapter = requests.adapters.HTTPAdapter(
            pool_connections=config.gleif_api_workers,
            pool_maxsize=config.gleif_api_workers,
            max_retries=3,
        )
        self._session.mount("https://", adapter)

    def _fetch_batch(self, lei_batch: List[str]) -> Tuple[List[Dict], List[Dict]]:
        lei_filter = ",".join(lei_batch)
        url = (
            f"{self.BASE_URL}"
            f"?filter[lei]={lei_filter}"
            f"&filter[entity.status]=ACTIVE"
            f"&page[size]={len(lei_batch)}"
        )
        companies, relationships = [], []
        try:
            response = self._session.get(url, timeout=60)
            response.raise_for_status()
            data = response.json()

            for record in data.get("data", []):
                attrs = record.get("attributes", {})
                entity = attrs.get("entity", {})
                lei = attrs.get("lei")
                if not lei:
                    continue

                legal_addr = entity.get("legalAddress", {})
                hq_addr = entity.get("headquartersAddress", {})
                hq_city = hq_addr.get("city")
                hq_country = hq_addr.get("country")
                headquarters = (
                    f"{hq_city}, {hq_country}" if hq_city and hq_country else hq_country
                )

                companies.append({
                    "lei": lei,
                    "legal_name": entity.get("legalName", {}).get("name"),
                    "jurisdiction": legal_addr.get("country"),
                    "headquarters": headquarters,
                })

                rels = record.get("relationships", {})
                direct_parent = rels.get("direct-parent", {}).get("data")
                if direct_parent:
                    parent_lei = direct_parent.get("id")
                    if parent_lei:
                        relationships.append({
                            "child_lei": lei, "parent_lei": parent_lei, "type": "direct",
                        })

                ultimate_parent = rels.get("ultimate-parent", {}).get("data")
                if ultimate_parent:
                    parent_lei = ultimate_parent.get("id")
                    if parent_lei and parent_lei != lei:
                        if not direct_parent or direct_parent.get("id") != parent_lei:
                            relationships.append({
                                "child_lei": lei, "parent_lei": parent_lei, "type": "ultimate",
                            })

            time.sleep(self.config.gleif_api_rate_limit)
        except Exception as e:
            print(f"  Warning: GLEIF batch failed: {e}")
        return companies, relationships


# =============================================================================
# ETL Pipeline (cached Wikidata, streaming GLEIF)
# =============================================================================


class ETLPipeline:
    def __init__(self, config: Config):
        self.config = config
        self.writer = Neo4jWriter(config)
        self.cache = WikidataCache(config)
        self.gleif = GleifApiClient(config)
        self.stats = {}

    def run(self):
        print("=" * 60)
        print("ETL Pipeline v3: Cached Wikidata + GLEIF API → Neo4j")
        print(f"  Cache: {self.config.cache_bucket or self.config.cache_local}")
        print(f"  GLEIF API workers: {self.config.gleif_api_workers}")
        print(f"  Neo4j write workers: {self.config.neo4j_write_workers}")
        print("=" * 60)

        # Check cache freshness
        manifest = self.cache.get_manifest()
        if manifest:
            print(f"  Cache built: {manifest.get('last_run_at', 'unknown')}")
        else:
            print("  WARNING: No manifest found — cache may be empty!")

        start_time = time.time()

        # Step 1: Load cached Wikidata companies with LEI
        t = time.time()
        print("\n[Step 1] Loading companies with LEI from cache...")
        wikidata_companies = self._process_cached_companies_with_lei()
        lei_set = {c["lei"] for c in wikidata_companies if c.get("lei")}
        wikidata_by_lei = {c["lei"]: c for c in wikidata_companies if c.get("lei")}
        print(f"  {len(lei_set)} unique LEIs ({time.time() - t:.2f}s)")

        # Steps 2+3: Stream GLEIF fetch → Neo4j writes
        t = time.time()
        print("\n[Steps 2+3] Streaming GLEIF fetch → Neo4j writes...")
        gleif_rels, company_count = self._stream_gleif_fetch_and_write(
            lei_set, wikidata_by_lei
        )
        self.stats["companies_with_lei"] = company_count
        print(f"  ({time.time() - t:.1f}s)")

        del wikidata_companies, wikidata_by_lei
        gc.collect()

        # Steps 4-8: GLEIF relationships + cached Wikidata enrichment (parallel)
        t = time.time()
        print("\n[Steps 4-8] GLEIF rels + Wikidata enrichment (parallel, cached)...")
        self._run_gleif_rels_and_enrichment(gleif_rels)
        print(f"  ({time.time() - t:.1f}s)")

        del gleif_rels
        gc.collect()

        duration = time.time() - start_time
        print(f"\n{'=' * 60}")
        print(f"ETL Complete in {duration:.1f}s")
        print(f"{'=' * 60}")
        self._print_stats()

    # ---- Step 1: Process cached companies with LEI ----

    def _process_cached_companies_with_lei(self) -> List[Dict]:
        results = self.cache.load("companies_with_lei")
        val = self.cache.val

        seen: Dict[str, Dict] = {}
        field_map = {
            "website": "website", "logo_url": "logo",
            "industry": "industryLabel", "description": "description",
            "headquarters": "hqLabel", "stock_exchange": "exchangeLabel",
            "ticker": "ticker", "cik": "cik",
        }

        for row in results:
            lei = val(row, "lei")
            if not lei:
                continue

            founded_year = None
            raw_year = val(row, "foundedYear")
            if raw_year:
                try:
                    founded_year = int(float(raw_year))
                except (ValueError, TypeError):
                    pass

            if lei not in seen:
                seen[lei] = {
                    "lei": lei,
                    "wikidata_id": self.cache.extract_qid(val(row, "company")),
                    "name": val(row, "companyLabel"),
                    "founded_year": founded_year,
                }
                for fname, skey in field_map.items():
                    seen[lei][fname] = val(row, skey)
            else:
                existing = seen[lei]
                for fname, skey in field_map.items():
                    if not existing.get(fname):
                        v = val(row, skey)
                        if v:
                            existing[fname] = v
                if not existing.get("founded_year") and founded_year:
                    existing["founded_year"] = founded_year

        print(f"  Deduplicated {len(results)} rows → {len(seen)} unique companies")
        return list(seen.values())

    # ---- Steps 2+3: Stream GLEIF + write ----

    def _stream_gleif_fetch_and_write(
        self, lei_set: Set[str], wikidata_by_lei: Dict[str, Dict]
    ) -> Tuple[List[Dict], int]:
        lei_list = list(lei_set)
        api_bs = self.config.gleif_api_batch_size
        api_batches = [
            lei_list[i : i + api_bs] for i in range(0, len(lei_list), api_bs)
        ]
        if not api_batches:
            return [], 0

        write_q: queue.Queue = queue.Queue(maxsize=8)
        total_written = [0]

        def _writer():
            while True:
                item = write_q.get()
                if item is None:
                    break
                try:
                    count = self.writer.merge_companies_batch(item, merge_field="lei")
                    total_written[0] += count
                except Exception as e:
                    print(f"  Warning: Neo4j write error: {e}")

        writer_thread = threading.Thread(target=_writer, daemon=True)
        writer_thread.start()

        all_raw_rels: List[Dict] = []
        company_buffer: List[Company] = []
        completed = 0

        with ThreadPoolExecutor(max_workers=self.config.gleif_api_workers) as pool:
            futures = {
                pool.submit(self.gleif._fetch_batch, b): i
                for i, b in enumerate(api_batches)
            }
            for future in as_completed(futures):
                companies, rels = future.result()
                all_raw_rels.extend(rels)
                completed += 1

                for g in companies:
                    lei = g["lei"]
                    w = wikidata_by_lei.get(lei, {})
                    company_buffer.append(Company(
                        name=w.get("name") or g.get("legal_name", ""),
                        lei=lei,
                        wikidata_id=w.get("wikidata_id"),
                        legal_name=g.get("legal_name"),
                        cik=w.get("cik"),
                        jurisdiction=g.get("jurisdiction") or w.get("jurisdiction"),
                        headquarters=g.get("headquarters") or w.get("headquarters"),
                        website=w.get("website"),
                        logo_url=w.get("logo_url"),
                        description=w.get("description"),
                        founded_year=w.get("founded_year"),
                        industry=w.get("industry"),
                        stock_exchange=w.get("stock_exchange"),
                        ticker=w.get("ticker"),
                        data_sources=["gleif", "wikidata"] if w else ["gleif"],
                    ))

                if len(company_buffer) >= self.config.batch_size:
                    write_q.put(company_buffer)
                    company_buffer = []

                if completed % 25 == 0 or completed == len(api_batches):
                    print(f"  GLEIF: {completed}/{len(api_batches)} batches")

        if company_buffer:
            write_q.put(company_buffer)
        write_q.put(None)
        writer_thread.join()

        # Filter relationships
        seen: Set[Tuple[str, str]] = set()
        filtered = []
        for rel in all_raw_rels:
            child, parent = rel["child_lei"], rel["parent_lei"]
            if child in lei_set and parent in lei_set:
                key = (child, parent)
                if key not in seen:
                    seen.add(key)
                    filtered.append({
                        "child_lei": child, "parent_lei": parent,
                        "source_url": f"https://search.gleif.org/#/record/{parent}",
                        "source": "gleif", "percentage": None,
                    })

        print(f"  {total_written[0]} companies, {len(filtered)} relationships")
        return filtered, total_written[0]

    # ---- Steps 4-8: Parallel enrichment from cache ----

    def _run_gleif_rels_and_enrichment(self, gleif_rels: List[Dict]):
        tasks = {
            "gleif_relationships": lambda: self._write_gleif_rels(gleif_rels),
            "companies_no_lei": self._load_companies_without_lei,
            "brands": self._load_brand_ownership,
            "company_ownership": self._load_company_ownership,
            "founders": self._load_founders,
            "ceos": self._load_ceos,
            "board_members": self._load_board_members,
        }

        # All cache loads are instant, so we're just parallelizing Neo4j writes
        with ThreadPoolExecutor(max_workers=7) as pool:
            futures = {pool.submit(fn): name for name, fn in tasks.items()}
            for future in as_completed(futures):
                name = futures[future]
                try:
                    future.result()
                    print(f"  ✓ {name}")
                except Exception as e:
                    print(f"  ✗ {name}: {e}")
                    traceback.print_exc()

    def _write_gleif_rels(self, relationships: List[Dict]):
        created = self.writer.create_ownership_batch_by_lei(relationships)
        self.stats["gleif_relationships"] = created
        print(f"  [gleif_rels] {created} rels")

    def _load_companies_without_lei(self):
        results = self.cache.load("companies_without_lei")
        val = self.cache.val

        seen: Dict[str, Company] = {}
        for row in results:
            qid = self.cache.extract_qid(val(row, "company"))
            if not qid or qid in seen:
                continue
            seen[qid] = Company(
                name=val(row, "companyLabel") or "",
                wikidata_id=qid,
                website=val(row, "website"),
                logo_url=val(row, "logo"),
                industry=val(row, "industryLabel"),
                description=val(row, "description"),
                data_sources=["wikidata"],
            )

        count = self.writer.merge_companies_batch(list(seen.values()), merge_field="wikidata_id")
        self.stats["companies_without_lei"] = count
        print(f"  [companies_no_lei] {count}")

    def _load_brand_ownership(self):
        results = self.cache.load("brand_ownership")
        val = self.cache.val

        rows = []
        seen: Set[Tuple[str, str]] = set()
        for row in results:
            brand_qid = self.cache.extract_qid(val(row, "brand"))
            owner_qid = self.cache.extract_qid(val(row, "owner"))
            ref_url = val(row, "refUrl")
            if not brand_qid or not owner_qid or not ref_url:
                continue
            key = (brand_qid, owner_qid)
            if key in seen:
                continue
            seen.add(key)
            rows.append({
                "brand_qid": brand_qid, "brand_id": str(uuid.uuid4()),
                "brand_name": val(row, "brandLabel") or "",
                "brand_logo": val(row, "brandLogo"),
                "brand_website": val(row, "brandWebsite"),
                "company_qid": owner_qid, "company_id": str(uuid.uuid4()),
                "company_name": val(row, "ownerLabel") or "",
                "source_url": ref_url, "source": "wikidata",
            })

        count = self.writer.merge_brands_and_ownership(rows)
        self.stats["brand_ownership"] = count
        print(f"  [brands] {count} rels")

    def _load_company_ownership(self):
        results = self.cache.load("company_ownership")
        val = self.cache.val

        rows = []
        seen: Set[Tuple[str, str]] = set()
        for row in results:
            child_qid = self.cache.extract_qid(val(row, "child"))
            parent_qid = self.cache.extract_qid(val(row, "parent"))
            ref_url = val(row, "refUrl")
            if not child_qid or not parent_qid or not ref_url:
                continue
            key = (child_qid, parent_qid)
            if key in seen:
                continue
            seen.add(key)
            rows.append({
                "child_qid": child_qid, "child_id": str(uuid.uuid4()),
                "child_name": val(row, "childLabel") or "",
                "parent_qid": parent_qid, "parent_id": str(uuid.uuid4()),
                "parent_name": val(row, "parentLabel") or "",
                "source_url": ref_url, "source": "wikidata",
            })

        count = self.writer.merge_company_ownership(rows)
        self.stats["wikidata_company_ownership"] = count
        print(f"  [company_ownership] {count} rels")

    def _load_person_generic(
        self, cache_key: str, rel_type: str, person_key: str, person_label_key: str
    ) -> int:
        results = self.cache.load(cache_key)
        val = self.cache.val

        rows = []
        seen: Set[Tuple[str, str]] = set()
        for row in results:
            company_qid = self.cache.extract_qid(val(row, "company"))
            person_qid = self.cache.extract_qid(val(row, person_key))
            ref_url = val(row, "refUrl")
            if not company_qid or not person_qid or not ref_url:
                continue
            key = (person_qid, company_qid)
            if key in seen:
                continue
            seen.add(key)

            start_date = val(row, "startDate")
            end_date = val(row, "endDate")
            rows.append({
                "person_qid": person_qid, "person_id": str(uuid.uuid4()),
                "person_name": val(row, person_label_key) or "",
                "company_qid": company_qid, "company_id": str(uuid.uuid4()),
                "company_name": val(row, "companyLabel") or "",
                "source_url": ref_url, "source": "wikidata",
                "role": val(row, "roleLabel"),
                "start_date": start_date[:10] if start_date else None,
                "end_date": end_date[:10] if end_date else None,
            })

        count = self.writer.merge_persons_and_relationships(rows, rel_type)
        print(f"  [{rel_type.lower()}] {count} rels")
        return count

    def _load_founders(self):
        self.stats["founders"] = self._load_person_generic(
            "founders", "FOUNDER", "founder", "founderLabel"
        )

    def _load_ceos(self):
        self.stats["ceos"] = self._load_person_generic(
            "ceos", "CEO", "ceo", "ceoLabel"
        )

    def _load_board_members(self):
        self.stats["board_members"] = self._load_person_generic(
            "board_members", "BOARD_MEMBER", "person", "personLabel"
        )

    def _print_stats(self):
        stats = self.writer.get_stats()
        print("\n" + "=" * 50)
        print("FINAL DATABASE STATISTICS")
        print("=" * 50)
        for label, count in sorted(stats.items()):
            print(f"  {label:35} {count:>10,}")
        print("=" * 50)

    def close(self):
        self.writer.close()


# =============================================================================
# Main
# =============================================================================


def main():
    parser = argparse.ArgumentParser(description="ETL v3: Cached Wikidata + GLEIF → Neo4j")
    parser.add_argument("--run", action="store_true", help="Run full ETL")
    parser.add_argument("--stats", action="store_true", help="Show database stats")
    parser.add_argument("--clear", action="store_true", help="Clear database")
    parser.add_argument("--cache-bucket", type=str, help="S3 bucket with Wikidata cache")
    parser.add_argument("--cache-local", type=str, help="Local cache directory")

    args = parser.parse_args()
    config = Config()

    if args.clear:
        writer = Neo4jWriter(config)
        confirm = input("DELETE ALL DATA. Type 'yes': ")
        if confirm == "yes":
            writer.clear_database()
        writer.close()
        return

    if args.stats:
        writer = Neo4jWriter(config)
        stats = writer.get_stats()
        print("\n" + "=" * 50)
        print("DATABASE STATISTICS")
        print("=" * 50)
        for label, count in sorted(stats.items()):
            print(f"  {label:35} {count:>10,}")
        print("=" * 50)
        writer.close()
        return

    if args.run:
        if not args.cache_bucket and not args.cache_local:
            parser.error("--run requires --cache-bucket or --cache-local")
        config.cache_bucket = args.cache_bucket
        config.cache_local = args.cache_local

        pipeline = ETLPipeline(config)
        try:
            pipeline.run()
        finally:
            pipeline.close()
        return

    parser.print_help()


if __name__ == "__main__":
    main()
