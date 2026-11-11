"""
Stage 23: ICIJ Offshore Leaks
Downloads bulk CSV from ICIJ and matches entities against known companies/persons.
"""

import csv
import io
import logging
import os
import zipfile
from typing import List, Dict, Set

import requests

from config import Config
from models import now_iso

logger = logging.getLogger(__name__)


def _download_and_extract(url: str, cache_dir: str) -> str:
    """Download ICIJ zip and extract to cache_dir. Returns path to extracted dir."""
    os.makedirs(cache_dir, exist_ok=True)
    extract_dir = os.path.join(cache_dir, "icij")

    # Check if already extracted
    entities_csv = os.path.join(extract_dir, "nodes-entities.csv")
    if os.path.exists(entities_csv):
        logger.info(f"Using cached ICIJ data at {extract_dir}")
        return extract_dir

    logger.info(f"Downloading ICIJ data from {url}...")
    resp = requests.get(url, timeout=300, stream=True)
    resp.raise_for_status()

    zip_path = os.path.join(cache_dir, "icij-offshore.zip")
    with open(zip_path, "wb") as f:
        for chunk in resp.iter_content(chunk_size=8192):
            f.write(chunk)

    os.makedirs(extract_dir, exist_ok=True)
    with zipfile.ZipFile(zip_path, "r") as zf:
        zf.extractall(extract_dir)

    logger.info(f"Extracted ICIJ data to {extract_dir}")
    return extract_dir


def _build_name_index(company_names: List[str]) -> Dict[str, str]:
    """Build lowercase name -> original name lookup."""
    return {n.lower(): n for n in company_names if n and len(n) >= 3}


def _build_prefix_index(name_index: Dict[str, str]) -> Dict[str, str]:
    """Build a prefix-based index for matching.
    Maps normalized name prefixes (first significant words) for partial matching.
    Only matches companies with names >= 8 chars to avoid false positives."""
    prefix_map: Dict[str, str] = {}
    for lower_name, original in name_index.items():
        # Only index names with 8+ chars for partial matching
        if len(lower_name) >= 8:
            # Use the full normalized name (without common suffixes) as the key
            normalized = lower_name
            for suffix in (" inc", " inc.", " corp", " corp.", " ltd", " ltd.",
                           " llc", " plc", " gmbh", " s.a.", " ag", " co.",
                           " limited", " corporation"):
                if normalized.endswith(suffix):
                    normalized = normalized[:-len(suffix)].strip()
                    break
            if len(normalized) >= 6 and normalized not in prefix_map:
                prefix_map[normalized] = original
    return prefix_map


def enrich(company_names: List[str], config: Config) -> List[Dict]:
    """
    Download ICIJ Offshore Leaks data and match against known companies.
    Returns OffshoreEntity dicts ready for neo4j_writer.merge_offshore_entities().
    """
    name_index = _build_name_index(company_names)
    if not name_index:
        logger.warning("Stage 23: No company names to match")
        return []

    prefix_index = _build_prefix_index(name_index)
    logger.info(f"Stage 23: built name index ({len(name_index)} exact, {len(prefix_index)} prefix keys)")

    extract_dir = _download_and_extract(config.icij_data_url, config.cache_dir)

    # Look for the entities CSV — filenames may vary
    entities_csv = None
    for fname in os.listdir(extract_dir):
        if "entities" in fname.lower() and fname.endswith(".csv"):
            entities_csv = os.path.join(extract_dir, fname)
            break

    if not entities_csv or not os.path.exists(entities_csv):
        # Try nested directory
        for root, dirs, files in os.walk(extract_dir):
            for fname in files:
                if "entities" in fname.lower() and fname.endswith(".csv"):
                    entities_csv = os.path.join(root, fname)
                    break
            if entities_csv:
                break

    if not entities_csv:
        logger.warning("Stage 23: Could not find entities CSV in ICIJ data")
        return []

    entities = []
    seen_ids = set()
    row_count = 0

    with open(entities_csv, "r", encoding="utf-8", errors="replace") as f:
        reader = csv.DictReader(f)
        for row in reader:
            row_count += 1
            if row_count % 100000 == 0:
                logger.info(f"Stage 23: processed {row_count} ICIJ rows, {len(entities)} entities so far")
            entity_name = (row.get("name") or row.get("entity_name") or "").strip()
            if not entity_name:
                continue

            entity_lower = entity_name.lower()

            # Match against known companies (exact match first, then prefix-based)
            matched_company = name_index.get(entity_lower)
            if not matched_company:
                # Normalize entity name and check prefix index
                norm_entity = entity_lower
                for suffix in (" inc", " inc.", " corp", " corp.", " ltd", " ltd.",
                               " llc", " plc", " gmbh", " s.a.", " ag", " co.",
                               " limited", " corporation"):
                    if norm_entity.endswith(suffix):
                        norm_entity = norm_entity[:-len(suffix)].strip()
                        break
                matched_company = prefix_index.get(norm_entity)

            node_id = row.get("node_id") or row.get("id") or str(row_count)
            icij_id = f"ICIJ-{node_id}"

            if icij_id in seen_ids:
                continue
            seen_ids.add(icij_id)

            # Determine investigation source
            source_id = (row.get("sourceID") or row.get("source") or "").lower()
            investigation = "unknown"
            if "panama" in source_id:
                investigation = "panama_papers"
            elif "paradise" in source_id:
                investigation = "paradise_papers"
            elif "pandora" in source_id:
                investigation = "pandora_papers"
            elif "bahamas" in source_id:
                investigation = "bahamas_leaks"
            elif "offshore" in source_id:
                investigation = "offshore_leaks"

            entities.append({
                "icij_id": icij_id,
                "name": entity_name[:300],
                "jurisdiction": row.get("jurisdiction") or row.get("jurisdiction_description") or "",
                "incorporation_date": row.get("incorporation_date") or "",
                "inactivation_date": row.get("inactivation_date") or "",
                "status": row.get("status") or "",
                "investigation": investigation,
                "company_name": matched_company,
                "source": "icij",
                "last_updated": now_iso(),
            })

    # Filter to only entities with a company match for relationship creation
    matched = [e for e in entities if e.get("company_name")]
    logger.info(
        f"Stage 23: processed {row_count} ICIJ rows, "
        f"found {len(entities)} entities total, "
        f"{len(matched)} matched to known companies"
    )
    return matched
