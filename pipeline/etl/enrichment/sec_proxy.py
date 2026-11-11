"""
Stage 15: SEC EDGAR Proxy Statements (DEF 14A) — Executive Compensation
Extracts CEO/executive pay data from proxy filings.
"""

import logging
import re
import time
import concurrent.futures
from typing import List, Dict, Optional

import requests

from config import Config
from enrichment import safe_get, safe_get_text, RateLimiter
from models import now_iso

logger = logging.getLogger(__name__)


def _parse_compensation_table(html: str) -> List[Dict]:
    """Extract executive compensation from Summary Compensation Table in proxy."""
    text = re.sub(r'<[^>]+>', ' ', html)
    text = re.sub(r'\s+', ' ', text)

    executives = []

    # Look for "Summary Compensation Table" section
    sct_match = re.search(r'Summary Compensation Table(.*?)(?:Grants of Plan|Option Exercises|Outstanding Equity)', text, re.IGNORECASE | re.DOTALL)
    if not sct_match:
        return []

    section = sct_match.group(1)

    # Look for name + dollar amount patterns
    # Typical: "John Smith ... CEO ... $1,234,567"
    name_pattern = re.compile(
        r'([A-Z][a-z]+ [A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s*'
        r'(?:.*?(?:Chief|CEO|President|CFO|COO|Officer|Executive|VP).*?)?'
        r'\$\s*([\d,]+)',
        re.IGNORECASE
    )

    matches = name_pattern.findall(section[:5000])
    seen_names = set()
    for name, amount_str in matches:
        name = name.strip()
        if name in seen_names or len(name) < 5:
            continue
        seen_names.add(name)

        try:
            amount = float(amount_str.replace(",", ""))
        except ValueError:
            continue

        if amount < 10000:  # Skip obviously wrong values
            continue

        executives.append({
            "person_name": name,
            "total_compensation": amount,
            "base_salary": None,
            "stock_awards": None,
        })

    return executives


def enrich(company_ciks: List[Dict], config: Config, on_progress=None) -> List[Dict]:
    """
    Fetch executive compensation from SEC proxy statements.
    Input: list of dicts with 'name' and 'cik'.
    Returns list of compensation dicts.
    """
    session = requests.Session()
    session.headers.update({
        "User-Agent": config.sec_user_agent,
        "Accept": "application/json",
    })
    rate_limiter = RateLimiter(config.sec_rate_limit)

    all_comp = []

    def process_company(i, company):
        cik = company.get("cik", "")
        name = company.get("name", "")
        if not cik:
            if on_progress:
                on_progress(name, i)
            return []

        # Get recent filings
        url = f"{config.sec_edgar_submissions}/CIK{cik.zfill(10)}.json"
        data = safe_get(session, url, timeout=15, rate_limiter=rate_limiter)
        if not data:
            if on_progress:
                on_progress(name, i)
            return []

        # Find most recent DEF 14A
        recent = data.get("filings", {}).get("recent", {})
        forms = recent.get("form", [])
        accessions = recent.get("accessionNumber", [])
        primary_docs = recent.get("primaryDocument", [])

        proxy_acc = None
        proxy_doc = None
        for form, acc, doc in zip(forms, accessions, primary_docs):
            if form == "DEF 14A":
                proxy_acc = acc
                proxy_doc = doc
                break

        if not proxy_acc:
            if on_progress:
                on_progress(name, i)
            return []

        # Fetch the proxy document
        acc_clean = proxy_acc.replace("-", "")
        doc_url = f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{acc_clean}/{proxy_doc}"
        html = safe_get_text(session, doc_url, timeout=30, rate_limiter=rate_limiter)

        if not html:
            if on_progress:
                on_progress(name, i)
            return []

        executives = _parse_compensation_table(html)
        for exec_data in executives:
            exec_data["cik"] = cik
            exec_data["company_name"] = name
            exec_data["fiscal_year"] = str(recent.get("reportDate", [""])[0])[:4] if recent.get("reportDate") else ""

        if executives:
            logger.debug(f"SEC Proxy: {name} -> {len(executives)} executives")

        if on_progress:
            on_progress(name, i)
            
        return executives

    with concurrent.futures.ThreadPoolExecutor(max_workers=config.max_workers) as executor:
        futures = [executor.submit(process_company, i, company) for i, company in enumerate(company_ciks)]
        for future in concurrent.futures.as_completed(futures):
            res = future.result()
            if res:
                all_comp.extend(res)

    logger.info(f"Stage 15: found {len(all_comp)} executive compensation records from SEC proxy")
    return all_comp
