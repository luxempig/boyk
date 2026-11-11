"""
Stage 14: Wikidata Extended Properties
Fetches country, industry, HQ, employees, revenue, stock info.
Delegates to WikidataClient.fetch_extended_properties().
"""

import logging
from typing import Dict, List, Tuple

from config import Config
from wikidata_client import WikidataClient
from models import now_iso

logger = logging.getLogger(__name__)


def enrich(config: Config) -> Tuple[List[Dict], Dict[str, set]]:
    """
    Fetch extended company properties from Wikidata.

    Returns (rows keyed by LEI for merging into existing Company nodes,
    {wikidata_id: set of P31 classes} for the non-business flag).
    """
    client = WikidataClient(config)
    raw = client.fetch_extended_properties()
    types = client.fetch_lei_company_types()

    # Deduplicate by LEI (keep first/most complete)
    by_lei = {}
    for item in raw:
        lei = item.get("lei")
        if not lei:
            continue
        if lei not in by_lei:
            by_lei[lei] = item
        else:
            # Merge: fill in blanks from this row
            existing = by_lei[lei]
            for key, val in item.items():
                if val and not existing.get(key):
                    existing[key] = val

    results = list(by_lei.values())
    logger.info(f"Stage 14: fetched extended properties for {len(results)} companies from Wikidata")
    return results, types
