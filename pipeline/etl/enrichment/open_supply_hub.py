"""
Stage 13: Open Supply Hub — Factory/Facility Data
1M+ production facilities worldwide with geolocation and brand connections.
"""

import logging
import time
from typing import List, Dict

import requests

from config import Config
from enrichment import safe_get
from models import now_iso

logger = logging.getLogger(__name__)


def enrich(company_names: List[str], config: Config, on_progress=None) -> List[Dict]:
    """
    Search Open Supply Hub for facilities linked to companies.
    Returns list of Facility dicts.
    Free tier: 5,000 facility downloads.
    """
    if not config.open_supply_hub_api_key:
        logger.warning("Stage 13: OPEN_SUPPLY_HUB_API_KEY not set, skipping")
        return []

    session = requests.Session()
    session.headers.update({
        "Authorization": f"Token {config.open_supply_hub_api_key}",
        "User-Agent": "BoykETL/2.0",
        "Accept": "application/json",
    })

    all_facilities = []
    seen_os_ids = set()
    facility_count = 0
    max_facilities = max(1, int(getattr(config, "open_supply_hub_max_facilities_total", 4500) or 4500))
    page_size = max(1, int(getattr(config, "open_supply_hub_page_size", 50) or 50))
    max_pages_per_company = max(1, int(getattr(config, "open_supply_hub_max_pages_per_company", 1) or 1))
    truncated_companies = 0
    global_cap_hit = False

    for i, company_name in enumerate(company_names):
        if facility_count >= max_facilities:
            logger.warning("Stage 13: approaching free tier limit, stopping")
            if on_progress:
                on_progress(company_name, i)
            global_cap_hit = True
            break

        company_hit_page_cap = False
        for page_no in range(1, max_pages_per_company + 1):
            url = f"{config.open_supply_hub_api_base}/facilities/"
            params = {
                "q": company_name,
                "pageSize": page_size,
                "page": page_no,
            }
            data = safe_get(session, url, params=params, timeout=20)
            time.sleep(0.5)

            if not data:
                break

            features = data.get("features", [])
            if not features:
                break

            for feature in features:
                if facility_count >= max_facilities:
                    global_cap_hit = True
                    break

                props = feature.get("properties", {})
                geometry = feature.get("geometry", {})
                coords = geometry.get("coordinates", [None, None])

                os_id = feature.get("id", "")
                if not os_id or os_id in seen_os_ids:
                    continue
                seen_os_ids.add(os_id)

                facility = {
                    "os_id": os_id,
                    "name": props.get("name", ""),
                    "country": props.get("country_name", props.get("country_code", "")),
                    "address": props.get("address", ""),
                    "lat": coords[1] if len(coords) > 1 else None,
                    "lng": coords[0] if len(coords) > 0 else None,
                    "num_workers": props.get("number_of_workers", {}).get("max") if isinstance(props.get("number_of_workers"), dict) else None,
                    "product_types": props.get("product_type", []) or [],
                    "company_name": company_name,
                    "source": "open_supply_hub",
                    "last_updated": now_iso(),
                }
                all_facilities.append(facility)
                facility_count += 1

            if global_cap_hit:
                break
            if len(features) < page_size:
                break
            if page_no >= max_pages_per_company:
                company_hit_page_cap = True

        if company_hit_page_cap:
            truncated_companies += 1
            logger.warning(
                f"Open Supply Hub: truncating {company_name} at "
                f"{max_pages_per_company} page(s) x {page_size} results"
            )
        if global_cap_hit:
            logger.warning(
                f"Open Supply Hub: global facility cap reached ({max_facilities}); stopping stage early"
            )
            if on_progress:
                on_progress(company_name, i)
            break

        if on_progress:
            on_progress(company_name, i)

    logger.info(
        f"Stage 13: found {len(all_facilities)} facilities from Open Supply Hub "
        f"(truncated companies: {truncated_companies}, page cap: {max_pages_per_company}, "
        f"page size: {page_size}, global cap hit: {global_cap_hit})"
    )
    return all_facilities
