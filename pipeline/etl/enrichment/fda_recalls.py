"""
Stage 21: FDA Recalls
Fetches food and drug enforcement actions (recalls) from openFDA API.
"""

import logging
import time
import concurrent.futures
import threading
from typing import List, Dict

import requests

from config import Config
from enrichment import safe_get, RateLimiter
from enrichment.firm_match import match_firm
from models import now_iso

logger = logging.getLogger(__name__)


def _format_date(date: str) -> str:
    """Format FDA date from '20210315' to '2021-03-15'."""
    if date and len(date) == 8:
        return f"{date[:4]}-{date[4:6]}-{date[6:8]}"
    return date


def _fetch_recalls(session: requests.Session, base_url: str,
                   endpoint: str, company_name: str, limit: int, skip: int = 0) -> List[Dict]:
    """Fetch recalls from a specific openFDA endpoint."""
    url = f"{base_url}/{endpoint}.json"
    # openFDA uses Elasticsearch-style queries
    params = {
        "search": f'recalling_firm:"{company_name}"',
        "limit": limit,
        "skip": skip,
    }
    data = safe_get(session, url, params=params, timeout=20)
    if not data:
        return []
    return data.get("results", [])


def enrich(company_names: List[str], config: Config, on_progress=None) -> List[Dict]:
    """
    Search openFDA for food and drug recalls by company name.
    Returns Recall dicts ready for neo4j_writer.merge_recalls().
    """
    # FDA is US-only; skip non-ASCII company names to avoid 400 errors
    ascii_names = [n for n in company_names if n.isascii()]
    skipped = len(company_names) - len(ascii_names)
    if skipped:
        logger.info(f"Stage 21: skipping {skipped} non-ASCII company names (FDA is US-only)")

    recalls = []
    seen_ids = set()
    lock = threading.Lock()
    page_size = max(1, int(getattr(config, "fda_recall_page_size", 50) or 50))
    max_pages = max(1, int(getattr(config, "fda_recall_max_pages_per_endpoint", 1) or 1))
    truncated_queries = 0
    rejected_firms = 0
    done_count = [0]
    # openFDA rate limit: 40 req/min = 1.5s between requests
    # With 3 workers, each needs 4.5s between requests to stay under 40/min total
    fda_rate_limiter = RateLimiter(1.5)

    endpoints = [
        "food/enforcement",
        "drug/enforcement",
    ]

    def process_company(args):
        nonlocal truncated_queries
        i, company_name = args
        local_session = requests.Session()
        local_session.headers.update({"User-Agent": "BoykETL/2.0 (contact@boyk.app)"})
        local_recalls = []
        local_truncated = 0
        local_rejected = 0

        for endpoint in endpoints:
            endpoint_hit_cap = False
            for page_no in range(max_pages):
                fda_rate_limiter.wait()
                results = _fetch_recalls(
                    local_session, config.fda_api_base, endpoint, company_name,
                    limit=page_size, skip=page_no * page_size
                )
                if not results:
                    break

                for result in results:
                    # openFDA's recalling_firm search is a phrase match anywhere in
                    # the name, so "Apple" returns Apple Valley Farms. Keep only
                    # recalls whose firm actually is the queried company.
                    firm = result.get("recalling_firm", "") or ""
                    match = match_firm(company_name, firm)
                    if not match:
                        local_rejected += 1
                        continue
                    recall_number = result.get("recall_number", "")
                    if not recall_number:
                        recall_number = result.get("event_id", "")
                    recall_id = f"FDA-{recall_number}"

                    local_recalls.append({
                        "recall_id": recall_id,
                        "product_name": (result.get("product_description", "") or "")[:500],
                        "company_name": company_name,
                        "firm_name": firm,
                        "matched_by": match[0],
                        "match_confidence": match[1],
                        "reason": (result.get("reason_for_recall", "") or "")[:500],
                        "classification": result.get("classification", ""),
                        "status": result.get("status", ""),
                        "date": _format_date(result.get("recall_initiation_date", "")),
                        "agency": "FDA",
                        "source": "fda",
                        "last_updated": now_iso(),
                    })

                if len(results) < page_size:
                    break
                if page_no + 1 >= max_pages:
                    endpoint_hit_cap = True

            if endpoint_hit_cap:
                local_truncated += 1

        if on_progress:
            on_progress(company_name, i)

        return local_recalls, local_truncated, local_rejected

    # Use 3 concurrent workers — the shared RateLimiter enforces the 40 req/min FDA limit
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
        futures = {executor.submit(process_company, (i, name)): i
                   for i, name in enumerate(ascii_names)}
        for future in concurrent.futures.as_completed(futures):
            local_recalls, local_truncated, local_rejected = future.result()
            with lock:
                for r in local_recalls:
                    if r["recall_id"] not in seen_ids:
                        seen_ids.add(r["recall_id"])
                        recalls.append(r)
                truncated_queries += local_truncated
                rejected_firms += local_rejected
                done_count[0] += 1
                if done_count[0] % 100 == 0:
                    logger.info(
                        f"Stage 21: processed {done_count[0]}/{len(ascii_names)} companies, "
                        f"{len(recalls)} recalls so far"
                    )

    logger.info(
        f"Stage 21: found {len(recalls)} FDA recalls "
        f"from {len(ascii_names)} companies ({skipped} non-ASCII skipped, "
        f"truncated queries: {truncated_queries}, page cap: {max_pages}, page size: {page_size}, "
        f"recalls from a different firm rejected: {rejected_firms})"
    )
    return recalls
