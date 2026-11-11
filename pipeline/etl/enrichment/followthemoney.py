"""
Stage 10: FollowTheMoney — State-Level Political Donations
Complements FEC federal data with state-level campaign contributions.
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
    Fetch state-level donation data from FollowTheMoney API.
    Returns list of donation dicts for neo4j_writer.create_donation_rels(source='followthemoney').
    """
    if not config.followthemoney_api_key:
        logger.warning("Stage 10: FOLLOWTHEMONEY_API_KEY not set, skipping")
        return []

    session = requests.Session()
    donations = []
    seen = set()

    for i, company_name in enumerate(company_names):
        url = f"{config.followthemoney_api_base}/FollowTheMoney.Disclosure.get.json"
        params = {
            "APIKey": config.followthemoney_api_key,
            "Contributor_Employer": company_name,
            "pagesize": 100,
        }
        data = safe_get(session, url, params=params, timeout=20)
        time.sleep(0.3)

        if not data:
            if on_progress:
                on_progress(company_name, i)
            continue

        records = data.get("records", [])
        if isinstance(records, dict):
            records = records.get("record", [])
        if isinstance(records, dict):
            records = [records]

        for record in records:
            candidate = record.get("Candidate", "")
            amount_str = record.get("Amount", "0")
            year = record.get("Election_Year", "")
            state = record.get("Election_Jurisdiction", "")
            party = record.get("Party", "")
            office = record.get("Office_Sought", "")

            try:
                amount = float(amount_str.replace(",", "").replace("$", ""))
            except (ValueError, AttributeError):
                amount = 0

            if not candidate:
                continue

            # Use composite key for dedup
            key = (company_name, candidate, year, state)
            if key in seen:
                continue
            seen.add(key)

            # Generate a deterministic fec_id-like identifier for state candidates
            fec_id = f"STATE-{state}-{candidate.replace(' ', '_')[:30]}"

            donations.append({
                "company_name": company_name,
                "fec_id": fec_id,
                "politician_name": candidate,
                "party": party,
                "state": state,
                "office": office,
                "amount": amount,
                "year": year,
            })

        if on_progress:
            on_progress(company_name, i)

    logger.info(f"Stage 10: found {len(donations)} state-level donation relationships from FollowTheMoney")
    return donations
