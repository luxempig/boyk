"""
GLEIF API Client — Stage 2
Fetches LEI entity data and parent-child relationships.
"""

import json
import logging
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import List, Dict, Set, Tuple

import requests

from config import Config
from models import now_iso

logger = logging.getLogger(__name__)


class GleifClient:
    def __init__(self, config: Config):
        self.config = config
        self.session = requests.Session()
        self.session.headers.update({
            "Accept": "application/vnd.api+json",
        })

    def _fetch_batch(self, leis: List[str]) -> Tuple[List[Dict], List[Dict]]:
        """Fetch a batch of LEIs with parent relationships inline.
        Uses ?include=direct-parent,ultimate-parent to get parent LEI data
        in the same response, eliminating per-company HTTP calls.
        """
        lei_filter = ",".join(leis)
        url = f"{self.config.gleif_api_base}/lei-records"
        params = {
            "filter[lei]": lei_filter,
            "page[size]": len(leis),
            "include": "direct-parent,ultimate-parent",
        }
        # Retry with backoff on rate-limit / server errors. Previously any
        # failure (very commonly HTTP 429, since batches fire concurrently)
        # silently returned [],[]; ~77% of batches failed nightly, which both
        # starved ownership data and — because the merged partial result looks
        # like a complete fetch — drove the stale-ownership retraction to delete
        # valid edges. Honouring Retry-After and backing off keeps far more
        # batches succeeding under the rate limit.
        retries = 4
        data = None
        for attempt in range(retries):
            try:
                resp = self.session.get(url, params=params, timeout=60)
                if resp.status_code == 429 or resp.status_code >= 500:
                    wait = int(resp.headers.get("Retry-After", min(60, 5 * (2 ** attempt))))
                    logger.warning(
                        f"GLEIF batch HTTP {resp.status_code}, waiting {wait}s "
                        f"(attempt {attempt + 1}/{retries})"
                    )
                    time.sleep(wait)
                    continue
                resp.raise_for_status()
                data = resp.json()
                break
            except Exception as e:
                logger.warning(f"GLEIF batch fetch attempt {attempt + 1}/{retries} failed: {e}")
                if attempt < retries - 1:
                    time.sleep(5 * (2 ** attempt))
        if data is None:
            logger.warning("GLEIF batch fetch failed after retries")
            return [], []

        # Build lookup from included records
        included_map = {}
        for inc in data.get("included", []):
            inc_lei = inc.get("attributes", {}).get("lei")
            if inc_lei:
                included_map[inc.get("id", "")] = inc_lei

        companies = []
        relationships = []

        for record in data.get("data", []):
            attrs = record.get("attributes", {})
            entity = attrs.get("entity", {})
            legal_name = entity.get("legalName", {}).get("name", "")
            jurisdiction = entity.get("jurisdiction", "")
            legal_address = entity.get("legalAddress", {})
            country = legal_address.get("country", "")
            city = legal_address.get("city", "")
            reg = attrs.get("registration", {})
            status = reg.get("status", "")
            child_lei = attrs.get("lei", "")

            companies.append({
                "lei": child_lei,
                "legal_name": legal_name,
                "jurisdiction": jurisdiction,
                "country": country,
                "city": city,
                "status": status,
            })

            # Extract relationships from inline data references
            rels = record.get("relationships", {})

            # Direct parent
            dp_data = rels.get("direct-parent", {}).get("data")
            if dp_data and isinstance(dp_data, dict):
                parent_id = dp_data.get("id", "")
                parent_lei = included_map.get(parent_id, parent_id)
                if parent_lei and parent_lei != child_lei:
                    relationships.append({
                        "child_lei": child_lei,
                        "parent_lei": parent_lei,
                        "relationship_type": "IS_DIRECTLY_CONSOLIDATED_BY",
                    })

            # Ultimate parent
            up_data = rels.get("ultimate-parent", {}).get("data")
            if up_data and isinstance(up_data, dict):
                parent_id = up_data.get("id", "")
                parent_lei = included_map.get(parent_id, parent_id)
                if parent_lei and parent_lei != child_lei:
                    relationships.append({
                        "child_lei": child_lei,
                        "parent_lei": parent_lei,
                        "relationship_type": "IS_ULTIMATELY_CONSOLIDATED_BY",
                    })

        return companies, relationships

    def fetch_all(self, lei_set: Set[str]) -> Tuple[List[Dict], List[Dict]]:
        """Fetch all LEIs in parallel batches. Returns (companies, relationships)."""
        lei_list = list(lei_set)
        batch_size = self.config.gleif_api_batch_size
        batches = [lei_list[i:i + batch_size] for i in range(0, len(lei_list), batch_size)]

        all_companies = []
        all_relationships = []

        logger.info(f"Stage 2: fetching {len(lei_list)} LEIs in {len(batches)} batches with {self.config.gleif_api_workers} workers")

        with ThreadPoolExecutor(max_workers=self.config.gleif_api_workers) as pool:
            futures = {pool.submit(self._fetch_batch, batch): i for i, batch in enumerate(batches)}
            done = 0
            for future in as_completed(futures):
                try:
                    companies, rels = future.result()
                    all_companies.extend(companies)
                    all_relationships.extend(rels)
                except Exception as e:
                    logger.warning(f"GLEIF batch failed: {e}")
                done += 1
                if done % 50 == 0:
                    logger.info(f"Stage 2: {done}/{len(batches)} batches complete")

        # Filter: at least child must be in our LEI set
        filtered_rels = []
        known_leis = {c["lei"] for c in all_companies}
        for rel in all_relationships:
            if rel["child_lei"] in known_leis:
                filtered_rels.append(rel)

        # Deduplicate
        seen = set()
        deduped_rels = []
        for rel in filtered_rels:
            key = (rel["child_lei"], rel["parent_lei"], rel["relationship_type"])
            if key not in seen:
                seen.add(key)
                deduped_rels.append(rel)

        logger.info(f"Stage 2: got {len(all_companies)} companies, {len(deduped_rels)} relationships from GLEIF")
        return all_companies, deduped_rels
