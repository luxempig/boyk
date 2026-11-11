"""
Stage 24: UK Companies House
Enriches companies with UK registration data and persons with significant control.
"""

import logging
import time
from typing import List, Dict

import requests

from config import Config
from enrichment import safe_get
from models import now_iso

logger = logging.getLogger(__name__)

# 600 requests per 5 minutes = 2 req/sec
RATE_LIMIT_DELAY = 0.5


def enrich(company_names: List[str], config: Config, on_progress=None) -> Dict[str, List[Dict]]:
    """
    Search UK Companies House for company info and persons with significant control.
    Returns dict with 'companies' and 'persons' lists.
    """
    if not config.uk_ch_api_key:
        logger.warning("Stage 24: UK_COMPANIES_HOUSE_API_KEY not set, skipping")
        return {"companies": [], "persons": []}

    session = requests.Session()
    session.auth = (config.uk_ch_api_key, "")  # Basic auth with API key as username
    session.headers.update({"User-Agent": "BoykETL/2.0 (contact@boyk.app)"})

    enriched_companies = []
    persons = []
    seen_companies = set()
    search_items_per_page = max(1, int(getattr(config, "uk_ch_search_items_per_page", 5) or 5))
    max_company_matches = max(1, int(getattr(config, "uk_ch_max_company_matches_per_query", 1) or 1))
    truncated_company_queries = 0

    for i, company_name in enumerate(company_names):
        # Search for company
        url = f"{config.uk_ch_api_base}/search/companies"
        params = {"q": company_name, "items_per_page": search_items_per_page}

        data = safe_get(session, url, params=params, timeout=20)
        if not data:
            if on_progress:
                on_progress(company_name, i)
            time.sleep(RATE_LIMIT_DELAY)
            continue

        items = data.get("items", [])
        matched_count = 0
        for item in items:
            company_number = item.get("company_number", "")
            if not company_number or company_number in seen_companies:
                continue

            title = item.get("title", "")
            # Only match if the name is reasonably close
            if company_name.lower() not in title.lower() and title.lower() not in company_name.lower():
                continue

            seen_companies.add(company_number)
            matched_count += 1

            address = item.get("address", {})
            enriched_companies.append({
                "name": company_name,
                "uk_company_number": company_number,
                "uk_company_status": item.get("company_status", ""),
                "uk_company_type": item.get("company_type", ""),
                "uk_registered_address": ", ".join(filter(None, [
                    address.get("address_line_1"),
                    address.get("locality"),
                    address.get("postal_code"),
                ])),
                "date_of_creation": item.get("date_of_creation", ""),
                "data_sources": ["uk_companies_house"],
                "last_updated": now_iso(),
            })

            # Fetch persons with significant control
            time.sleep(RATE_LIMIT_DELAY)
            psc_url = f"{config.uk_ch_api_base}/company/{company_number}/persons-with-significant-control"
            psc_data = safe_get(session, psc_url, timeout=20)
            if psc_data:
                for psc in psc_data.get("items", []):
                    person_name = psc.get("name", "")
                    if not person_name:
                        continue
                    persons.append({
                        "person_name": person_name,
                        "company_name": company_name,
                        "role": "significant_control",
                        "natures_of_control": psc.get("natures_of_control", []),
                        "nationality": psc.get("nationality", ""),
                        "country_of_residence": psc.get("country_of_residence", ""),
                        "source": "uk_companies_house",
                        "last_updated": now_iso(),
                    })

            if matched_count >= max_company_matches:
                break

        if matched_count >= max_company_matches:
            # If there may be more results than we processed, surface the truncation explicitly.
            total_results = data.get("total_results")
            if (isinstance(total_results, int) and total_results > matched_count) or len(items) >= search_items_per_page:
                truncated_company_queries += 1
                logger.warning(
                    f"UK CH: truncating matches for {company_name} at {max_company_matches} "
                    f"(search items/page={search_items_per_page})"
                )

        if on_progress:
            on_progress(company_name, i)
        time.sleep(RATE_LIMIT_DELAY)

    logger.info(
        f"Stage 24: enriched {len(enriched_companies)} companies, "
        f"found {len(persons)} persons with significant control "
        f"(truncated company queries: {truncated_company_queries}, "
        f"search items/page: {search_items_per_page}, match cap/query: {max_company_matches})"
    )
    return {"companies": enriched_companies, "persons": persons}
