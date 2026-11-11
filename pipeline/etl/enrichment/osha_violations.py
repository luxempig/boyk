"""
Stage 18: OSHA Workplace Violations
Downloads bulk CSV from DOL enforcement data and matches against company names.

DOL moved bulk downloads from enforcedata.dol.gov to enfxfr.dol.gov with
date-stamped filenames. We discover the current URL by scraping the data
catalog page, falling back to a date-based URL pattern.
"""

import csv
import io
import logging
import os
import re
import zipfile
from datetime import datetime, timedelta
from typing import List, Dict, Set

import requests

from config import Config
from models import now_iso

logger = logging.getLogger(__name__)

CATALOG_URL = "https://enforcedata.dol.gov/views/data_summary.php"


def _discover_violation_csv_url() -> str:
    """Scrape the DOL data catalog to find the current OSHA violation CSV URL."""
    try:
        resp = requests.post(
            CATALOG_URL,
            data={"agency": "osha"},
            timeout=30,
            headers={"User-Agent": "BoykETL/2.0"},
        )
        if resp.status_code != 200:
            return ""
        urls = re.findall(
            r'https://enfxfr\.dol\.gov[^"\'\\s]*osha_violation[^"\'\\s]*\.csv\.zip',
            resp.text,
        )
        if urls:
            # The URL contains /../ which requests handles via redirect
            return urls[0]
    except Exception as e:
        logger.warning(f"Failed to scrape OSHA data catalog: {e}")
    return ""


def _fallback_violation_url() -> str:
    """Construct a date-based fallback URL using today's or yesterday's date."""
    for delta in range(0, 3):
        date_str = (datetime.utcnow() - timedelta(days=delta)).strftime("%Y%m%d")
        url = f"https://enfxfr.dol.gov/data_catalog/OSHA/osha_violation_{date_str}.csv.zip"
        try:
            resp = requests.head(url, timeout=10, allow_redirects=True)
            if resp.status_code == 200:
                return url
        except Exception:
            continue
    return ""


def _resolve_osha_url(config: Config) -> str:
    """Find a working OSHA violation CSV download URL."""
    # Try scraping the catalog first
    url = _discover_violation_csv_url()
    if url:
        logger.info(f"Stage 18: discovered OSHA CSV URL from catalog: {url}")
        return url

    # Fall back to date-based URL
    url = _fallback_violation_url()
    if url:
        logger.info(f"Stage 18: using date-based OSHA CSV URL: {url}")
        return url

    # Last resort: use config (may be stale)
    logger.warning("Stage 18: could not discover OSHA URL, using config default")
    return config.osha_data_url


def _download_and_extract_csv(url: str, cache_dir: str, filename: str) -> str:
    """Download a ZIP file and extract the CSV. Uses local cache."""
    os.makedirs(cache_dir, exist_ok=True)
    csv_path = os.path.join(cache_dir, filename)

    if os.path.exists(csv_path):
        logger.info(f"Using cached {csv_path}")
        return csv_path

    logger.info(f"Downloading {url}...")
    resp = requests.get(url, timeout=120, stream=True, allow_redirects=True)
    resp.raise_for_status()

    zip_path = os.path.join(cache_dir, filename + ".zip")
    with open(zip_path, "wb") as f:
        for chunk in resp.iter_content(chunk_size=8192):
            f.write(chunk)

    with zipfile.ZipFile(zip_path, "r") as zf:
        names = zf.namelist()
        csv_name = [n for n in names if n.endswith(".csv")]
        if not csv_name:
            logger.error(f"No CSV found in {zip_path}")
            return ""
        zf.extract(csv_name[0], cache_dir)
        extracted = os.path.join(cache_dir, csv_name[0])
        if extracted != csv_path:
            os.rename(extracted, csv_path)

    logger.info(f"Extracted {csv_path}")
    return csv_path


def enrich(company_names: List[str], config: Config) -> List[Dict]:
    """
    Download OSHA violation data and match against known companies.
    Returns violation dicts ready for neo4j_writer.merge_violations().
    """
    # Build a lookup set for fast matching (lowercase). Exact establishment-name
    # equality only — the previous single-shared-word fallback (any >=5-char word
    # in common) attributed a violation to a company on one coincidental word and
    # was a major source of misattribution (audit C2). A shared word is not
    # evidence of identity.
    name_set = {n.lower(): n for n in company_names if n}

    # Discover current download URL
    osha_url = _resolve_osha_url(config)

    # Download violation CSV
    csv_path = _download_and_extract_csv(
        osha_url,
        config.cache_dir,
        "osha_violation.csv"
    )
    if not csv_path or not os.path.exists(csv_path):
        logger.warning("Stage 18: Could not download OSHA data")
        return []

    violations = []
    matched_companies = set()
    row_count = 0

    with open(csv_path, "r", encoding="utf-8", errors="replace") as f:
        reader = csv.DictReader(f)
        for row in reader:
            row_count += 1
            if row_count % 500000 == 0:
                logger.info(f"Stage 18: processed {row_count} OSHA rows, {len(violations)} violations so far")
            employer = (row.get("estab_name") or "").strip()
            if not employer:
                continue

            employer_lower = employer.lower()
            matched_name = name_set.get(employer_lower)
            if not matched_name:
                continue

            matched_companies.add(matched_name)
            activity_nr = row.get("activity_nr", "")
            citation_id = row.get("citation_id", "")
            case_id = f"OSHA-{activity_nr}-{citation_id}" if activity_nr else f"OSHA-{row_count}"

            penalty = 0
            try:
                penalty = float(row.get("current_penalty", 0) or 0)
            except (ValueError, TypeError):
                pass

            year = None
            issuance_date = row.get("issuance_date", "")
            if issuance_date and len(issuance_date) >= 4:
                try:
                    year = int(issuance_date[:4])
                except ValueError:
                    pass

            violations.append({
                "case_id": case_id,
                "company_name": matched_name,
                "agency": "OSHA",
                "offense_type": row.get("viol_type", ""),
                "penalty_amount": penalty,
                "year": year,
                "description": row.get("hazsub1", ""),
                "source": "osha",
                "last_updated": now_iso(),
            })

    logger.info(
        f"Stage 18: processed {row_count} OSHA rows, "
        f"matched {len(violations)} violations across {len(matched_companies)} companies"
    )
    return violations
