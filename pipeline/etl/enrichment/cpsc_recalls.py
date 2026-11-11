"""
Stage 22: CPSC Product Recalls
Fetches consumer product recalls from CPSC API.
"""

import logging
import time
from typing import List, Dict

import requests

from config import Config
from enrichment import safe_get
from enrichment.firm_match import match_firm
from models import now_iso

logger = logging.getLogger(__name__)

# Roles that make a recall the firm's own. Retailers only sold the product, so a
# name match there ("Sold exclusively at Walmart") is not Walmart's recall.
_RESPONSIBLE_ROLES = ("Manufacturers", "Importers", "Distributors")


def _responsible_firm(result: dict, company_name: str):
    """Return (firm_name, role, matched_by, confidence) for the first responsible
    firm on the recall that is the queried company, or None."""
    for role in _RESPONSIBLE_ROLES:
        for firm in result.get(role) or []:
            name = firm.get("Name", "") if isinstance(firm, dict) else str(firm)
            match = match_firm(company_name, name)
            if match:
                return name, role[:-1].lower(), match[0], match[1]
    return None


def enrich(company_names: List[str], config: Config, on_progress=None) -> List[Dict]:
    """
    Search CPSC for consumer product recalls by company name.
    Returns Recall dicts ready for neo4j_writer.merge_recalls().
    """
    session = requests.Session()
    session.headers.update({"User-Agent": "BoykETL/2.0 (contact@boyk.app)"})

    # CPSC is US-only; skip non-ASCII company names
    ascii_names = [n for n in company_names if n.isascii()]
    skipped = len(company_names) - len(ascii_names)
    if skipped:
        logger.info(f"Stage 22: skipping {skipped} non-ASCII company names (CPSC is US-only)")

    recalls = []
    seen_ids = set()
    rejected = 0

    for i, company_name in enumerate(ascii_names):
        if (i + 1) % 100 == 0:
            logger.info(f"Stage 22: processed {i + 1}/{len(ascii_names)} companies, {len(recalls)} recalls so far")
        url = f"{config.cpsc_api_base}/Recall"
        params = {
            "RecallTitle": company_name,
            "format": "json",
        }

        data = safe_get(session, url, params=params, timeout=20)
        if not data:
            if on_progress:
                on_progress(company_name, i)
            continue

        results = []
        if isinstance(data, list):
            results = data
        elif isinstance(data, dict):
            results = data.get("Results", data.get("results", []))

        for result in results:
            recall_number = str(result.get("RecallNumber", result.get("RecallID", "")))
            if not recall_number:
                continue
            recall_id = f"CPSC-{recall_number}"

            if recall_id in seen_ids:
                continue
            # RecallTitle is a substring search over the title, so "ICA" or
            # "Ice" returns unrelated recalls. The company has to be a
            # manufacturer, importer or distributor on the recall itself.
            firm = _responsible_firm(result, company_name)
            if not firm:
                rejected += 1
                continue
            seen_ids.add(recall_id)

            # Extract product names from products array if available
            products = result.get("Products", [])
            product_name = ""
            if products and isinstance(products, list):
                names = [p.get("Name", "") for p in products if isinstance(p, dict)]
                product_name = "; ".join(n for n in names if n)[:500]
            if not product_name:
                product_name = result.get("Title", result.get("RecallTitle", ""))

            recalls.append({
                "recall_id": recall_id,
                "product_name": product_name[:500] if product_name else "",
                "company_name": company_name,
                "firm_name": firm[0],
                "firm_role": firm[1],
                "matched_by": firm[2],
                "match_confidence": firm[3],
                "reason": (result.get("Description", "") or "")[:500],
                "classification": "",
                "status": result.get("Status", ""),
                "date": result.get("RecallDate", ""),
                "agency": "CPSC",
                "source": "cpsc",
                "last_updated": now_iso(),
            })

        if on_progress:
            on_progress(company_name, i)
        time.sleep(1)  # Be polite

    logger.info(
        f"Stage 22: found {len(recalls)} CPSC recalls "
        f"from {len(ascii_names)} companies ({skipped} non-ASCII skipped, "
        f"recalls without the company as manufacturer/importer/distributor rejected: {rejected})"
    )
    return recalls
