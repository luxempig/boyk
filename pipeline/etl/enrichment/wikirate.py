"""
Stage 12: WikiRate — ESG & Supply Chain Metrics
Open data platform with ESG scores from multiple methodologies.
"""

import logging
import time
from typing import List, Dict

import requests

from config import Config
from enrichment import safe_get
from models import now_iso

logger = logging.getLogger(__name__)

# Key metrics to fetch from WikiRate
TARGET_METRICS = [
    "Violation Tracker Penalties Total",
    "Fashion Transparency Index Score",
    "CDP Climate Change Score",
    "Science Based Targets initiative Status",
    "Living Wage Commitment",
    "Modern Slavery Statement",
]


def _search_company(session: requests.Session, company_name: str, base_url: str) -> List[Dict]:
    """Search WikiRate for a company and return its metric values."""
    # Search for the company
    url = f"{base_url}/search.json"
    params = {"query": company_name, "type": "Company"}
    data = safe_get(session, url, params=params, timeout=15)
    if not data or not data.get("items"):
        return []

    # Take the first match
    company_item = data["items"][0]
    company_id = company_item.get("id") or company_item.get("name", "")

    if not company_id:
        return []

    # Fetch metric answers for this company
    scores = []
    url = f"{base_url}/{company_id}+answer.json"
    params = {"limit": 200}
    answers = safe_get(session, url, params=params, timeout=20)
    time.sleep(0.5)

    if not answers:
        return []

    items = answers.get("items", [])
    for item in items:
        metric_name = item.get("metric", "")
        value = item.get("value", "")
        year = item.get("year")
        designer = item.get("designer", "")

        if not value or value.lower() in ("unknown", "n/a", ""):
            continue

        scores.append({
            "company_name": company_name,
            "metric_name": metric_name,
            "value": value,
            "year": int(year) if year else None,
            "designer": designer,
            "methodology": "wikirate_community",
            "source": "wikirate",
            "last_updated": now_iso(),
        })

    return scores


def enrich(company_names: List[str], config: Config, on_progress=None) -> List[Dict]:
    """
    Fetch ESG scores from WikiRate.
    Returns list of ESGScore dicts.
    """
    session = requests.Session()
    session.headers.update({
        "User-Agent": "BoykETL/2.0",
        "Accept": "application/json",
    })

    all_scores = []

    for i, company_name in enumerate(company_names):
        scores = _search_company(session, company_name, config.wikirate_api_base)
        all_scores.extend(scores)
        if scores:
            logger.debug(f"WikiRate: {company_name} -> {len(scores)} metrics")
        if on_progress:
            on_progress(company_name, i)
        time.sleep(1)

    logger.info(f"Stage 12: found {len(all_scores)} ESG scores from WikiRate")
    return all_scores
