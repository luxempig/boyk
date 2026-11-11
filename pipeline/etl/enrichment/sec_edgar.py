"""
Stage 6: SEC EDGAR — 10-K Supplier/Customer Relationships
Parses Exhibit 21 (subsidiaries) and mines 10-K text for major customer/supplier mentions.
"""

import logging
import re
import time
import concurrent.futures
from typing import List, Dict, Optional

import requests

from config import Config
from enrichment import safe_get, RateLimiter
from models import now_iso

logger = logging.getLogger(__name__)


class SECEdgarClient:
    def __init__(self, config: Config):
        self.config = config
        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": self.config.sec_user_agent,
            "Accept": "application/json",
        })
        self.rate_limiter = RateLimiter(self.config.sec_rate_limit)

    def _search_company(self, name: str) -> Optional[Dict]:
        """Search EDGAR full-text for a company, return CIK and metadata."""
        url = f"{self.config.sec_edgar_base}/search-index"
        params = {"q": name, "dateRange": "custom", "startdt": "2020-01-01", "forms": "10-K"}
        data = safe_get(self.session, url, params=params, timeout=15, rate_limiter=self.rate_limiter)
        if data and data.get("hits", {}).get("hits"):
            hit = data["hits"]["hits"][0]["_source"]
            return {
                "cik": str(hit.get("entity_id", "")).zfill(10),
                "name": hit.get("entity_name", ""),
            }
        return None

    def _get_submissions(self, cik: str) -> Optional[Dict]:
        """Get company submissions/filings metadata."""
        url = f"{self.config.sec_edgar_submissions}/CIK{cik.zfill(10)}.json"
        return safe_get(self.session, url, timeout=15, rate_limiter=self.rate_limiter)

    def _get_10k_exhibit21(self, cik: str, accession: str) -> List[Dict]:
        """Parse Exhibit 21 from a 10-K filing for subsidiary list."""
        # Exhibit 21 lists subsidiaries
        acc_clean = accession.replace("-", "")
        index_url = f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{acc_clean}/index.json"
        index_data = safe_get(self.session, index_url, timeout=15, rate_limiter=self.rate_limiter)
        if not index_data:
            return []

        # Find exhibit 21 document
        for item in index_data.get("directory", {}).get("item", []):
            name_lower = item.get("name", "").lower()
            if "ex21" in name_lower or "exhibit21" in name_lower:
                doc_url = f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{acc_clean}/{item['name']}"
                self.rate_limiter.wait()
                try:
                    resp = self.session.get(doc_url, timeout=20)
                    resp.raise_for_status()
                    return self._parse_exhibit21(resp.text)
                except Exception as e:
                    logger.debug(f"Failed to fetch exhibit 21: {e}")
        return []

    def _parse_exhibit21(self, html: str) -> List[Dict]:
        """Extract subsidiary names and jurisdictions from Exhibit 21 HTML."""
        # Strip HTML tags
        text = re.sub(r"<[^>]+>", " ", html)
        text = re.sub(r"\s+", " ", text)

        subsidiaries = []
        # Common pattern: "Company Name  State/Country"
        # Match lines that look like company entries
        lines = text.split("\n")
        for line in lines:
            line = line.strip()
            if len(line) < 5 or len(line) > 200:
                continue
            # Skip headers
            if any(h in line.lower() for h in ["exhibit", "subsidiary", "jurisdiction", "state", "name"]):
                continue
            # Simple heuristic: if it contains comma or tab, might be name + jurisdiction
            parts = re.split(r"\t|  +", line)
            if len(parts) >= 2:
                name = parts[0].strip().rstrip(",")
                jurisdiction = parts[-1].strip()
                if name and len(name) > 2:
                    subsidiaries.append({
                        "name": name,
                        "jurisdiction": jurisdiction,
                    })
        return subsidiaries

    def _extract_customers_suppliers(self, cik: str, accession: str) -> Dict:
        """Mine 10-K text for mentions of major customers and suppliers."""
        acc_clean = accession.replace("-", "")
        index_url = f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{acc_clean}/index.json"
        index_data = safe_get(self.session, index_url, timeout=15, rate_limiter=self.rate_limiter)
        if not index_data:
            return {"customers": [], "suppliers": []}

        # Find the main 10-K document
        doc_url = None
        for item in index_data.get("directory", {}).get("item", []):
            name = item.get("name", "")
            if name.endswith(".htm") and "ex" not in name.lower():
                doc_url = f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{acc_clean}/{name}"
                break

        if not doc_url:
            return {"customers": [], "suppliers": []}

        self.rate_limiter.wait()
        try:
            resp = self.session.get(doc_url, timeout=30)
            text = re.sub(r"<[^>]+>", " ", resp.text)
            text = re.sub(r"\s+", " ", text)
        except Exception:
            return {"customers": [], "suppliers": []}

        customers = set()
        suppliers = set()

        # Look for "major customer" / "significant customer" patterns
        customer_patterns = [
            r"(?:major|significant|largest|principal)\s+customer[s]?\s+(?:include[sd]?|(?:is|are|was|were))\s+([A-Z][A-Za-z\s&,]+?)(?:\.|,\s+which)",
            r"([A-Z][A-Za-z\s&]+?)\s+accounted\s+for\s+(?:approximately\s+)?(\d+)%",
        ]
        for pattern in customer_patterns:
            matches = re.findall(pattern, text[:50000])  # first 50K chars
            for match in matches:
                name = match[0] if isinstance(match, tuple) else match
                name = name.strip().rstrip(",")
                if 5 < len(name) < 60:
                    customers.add(name)

        # Look for "supplier" / "vendor" patterns
        supplier_patterns = [
            r"(?:major|key|primary|principal)\s+(?:supplier|vendor)[s]?\s+(?:include[sd]?|(?:is|are))\s+([A-Z][A-Za-z\s&,]+?)(?:\.|,\s+which)",
        ]
        for pattern in supplier_patterns:
            matches = re.findall(pattern, text[:50000])
            for match in matches:
                name = match.strip().rstrip(",")
                if 5 < len(name) < 60:
                    suppliers.add(name)

        return {"customers": list(customers), "suppliers": list(suppliers)}


def enrich(company_ciks: List[Dict], config: Config,
           on_progress=None) -> Dict:
    """
    Fetch supply chain data from SEC EDGAR.
    Input: list of dicts with 'name' and 'cik'.
    Returns dict with 'supply_rels' and 'subsidiaries'.

    Args:
        on_progress: Optional callback(company_name, index) called after each company.
    """
    client = SECEdgarClient(config)
    supply_rels = []
    subsidiaries = []
    
    def process_company(idx, company):
        cik = company.get("cik", "")
        name = company.get("name", "")
        if not cik:
            return None

        submissions = client._get_submissions(cik)
        if not submissions:
            return None

        # Find most recent 10-K
        recent = submissions.get("filings", {}).get("recent", {})
        forms = recent.get("form", [])
        accessions = recent.get("accessionNumber", [])

        latest_10k_acc = None
        for form, acc in zip(forms, accessions):
            if form == "10-K":
                latest_10k_acc = acc
                break

        if not latest_10k_acc:
            return None

        # Extract customers/suppliers
        cs = client._extract_customers_suppliers(cik, latest_10k_acc)
        local_supply_rels = []
        for cust in cs["customers"]:
            local_supply_rels.append({
                "supplier_name": name,
                "customer_name": cust,
                "confidence": "medium",
                "filing_type": "10-K",
            })
        for supp in cs["suppliers"]:
            local_supply_rels.append({
                "supplier_name": supp,
                "customer_name": name,
                "confidence": "medium",
                "filing_type": "10-K",
            })

        # Extract subsidiaries from Exhibit 21
        subs = client._get_10k_exhibit21(cik, latest_10k_acc)
        local_subsidiaries = []
        for sub in subs:
            local_subsidiaries.append({
                "parent_name": name,
                "parent_cik": cik,
                "subsidiary_name": sub["name"],
                "jurisdiction": sub.get("jurisdiction", ""),
            })

        logger.debug(f"SEC: {name} -> {len(cs['customers'])} customers, {len(cs['suppliers'])} suppliers, {len(subs)} subsidiaries")

        if on_progress:
            on_progress(name, idx)
            
        return local_supply_rels, local_subsidiaries

    with concurrent.futures.ThreadPoolExecutor(max_workers=config.max_workers) as executor:
        futures = [executor.submit(process_company, idx, company) for idx, company in enumerate(company_ciks)]
        for future in concurrent.futures.as_completed(futures):
            res = future.result()
            if res:
                supply_rels.extend(res[0])
                subsidiaries.extend(res[1])

    logger.info(f"Stage 6: found {len(supply_rels)} supply relationships, {len(subsidiaries)} subsidiaries from SEC EDGAR")
    return {"supply_rels": supply_rels, "subsidiaries": subsidiaries}
