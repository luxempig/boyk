"""
Stage 19: USAspending Government Contracts
Searches federal awards by company name.
"""

import logging
import time
from typing import List, Dict

import requests

from config import Config
from company_resolver import normalize_company_name
from enrichment import safe_get
from models import now_iso

logger = logging.getLogger(__name__)


def enrich(company_names: List[str], config: Config, on_progress=None) -> List[Dict]:
    """
    Search USAspending for government contracts awarded to each company.
    Returns GovernmentContract dicts ready for neo4j_writer.merge_government_contracts().
    """
    session = requests.Session()
    session.headers.update({"User-Agent": "BoykETL/2.0 (contact@boyk.app)"})

    contracts = []
    seen_awards = set()
    page_size = max(1, int(getattr(config, "usaspending_page_size", 50) or 50))
    max_pages = max(1, int(getattr(config, "usaspending_max_pages_per_company", 1) or 1))
    truncated_companies = 0

    for i, company_name in enumerate(company_names):
        if (i + 1) % 100 == 0:
            logger.info(f"Stage 19: processed {i + 1}/{len(company_names)} companies, {len(contracts)} contracts so far")
        url = f"{config.usaspending_api_base}/search/spending_by_award/"
        hit_page_cap = False
        for page_no in range(1, max_pages + 1):
            payload = {
                "filters": {
                    "recipient_search_text": [company_name],
                    "award_type_codes": ["A", "B", "C", "D"],  # Contracts only
                },
                "fields": [
                    "Award ID", "Recipient Name", "Recipient UEI", "Awarding Agency",
                    "Award Amount", "Description", "NAICS Code",
                    "Start Date", "End Date", "Contract Award Type",
                ],
                "limit": page_size,
                "page": page_no,
                "sort": "Award Amount",
                "order": "desc",
            }

            try:
                resp = session.post(url, json=payload, timeout=30)
                if resp.status_code == 429:
                    time.sleep(30)
                    break
                if resp.status_code != 200:
                    break
                data = resp.json()
            except Exception as e:
                logger.warning(f"USAspending request failed for {company_name}: {e}")
                break

            results = data.get("results", [])
            if not results:
                break

            for result in results:
                award_id = result.get("Award ID", "")
                # recipient_search_text is a fuzzy server-side search and the
                # response's own "Recipient Name" was never compared — the
                # mechanism behind one award being attributed to 73 companies
                # (audit C2). A federal award has exactly one recipient: accept
                # it only when the recipient's registered name normalizes equal
                # to the queried company.
                recipient = (result.get("Recipient Name") or "").strip()
                if not award_id or not recipient:
                    continue
                if normalize_company_name(recipient) != normalize_company_name(company_name):
                    continue
                # award_id alone is a per-agency PIID fragment ('0006' collides
                # across agencies) — dedupe on (award, recipient) instead.
                seen_key = (award_id, recipient.lower())
                if seen_key in seen_awards:
                    continue
                seen_awards.add(seen_key)

                amount = 0
                try:
                    amount = float(result.get("Award Amount", 0) or 0)
                except (ValueError, TypeError):
                    pass

                contracts.append({
                    "award_id": award_id,
                    "company_name": company_name,
                    "recipient_name": recipient,
                    "recipient_uei": (result.get("Recipient UEI") or "").strip(),
                    "matched_by": "recipient_name_verified",
                    "match_confidence": "high",
                    "agency": result.get("Awarding Agency", ""),
                    "amount": amount,
                    "description": (result.get("Description", "") or "")[:500],
                    "naics_code": result.get("NAICS Code", ""),
                    "start_date": result.get("Start Date", ""),
                    "end_date": result.get("End Date", ""),
                    "contract_type": result.get("Contract Award Type", ""),
                    "source": "usaspending",
                    "last_updated": now_iso(),
                })

            if len(results) < page_size:
                break
            if page_no >= max_pages:
                hit_page_cap = True

        if hit_page_cap:
            truncated_companies += 1
            logger.warning(
                f"USAspending: truncating {company_name} at {max_pages} page(s) x {page_size} rows"
            )

        if on_progress:
            on_progress(company_name, i)
        time.sleep(1)  # Be polite

    logger.info(
        f"Stage 19: found {len(contracts)} government contracts "
        f"from {len(company_names)} companies "
        f"(truncated companies: {truncated_companies}, page cap: {max_pages}, page size: {page_size})"
    )
    return contracts
