"""
Stage 16: EPA ECHO — Environmental Compliance History
Government-verified environmental violations per facility.
Free REST API, no key needed.

API uses a two-step pattern (since echodata.epa.gov migration):
  1. get_facilities — search by name, returns summary stats + QueryID
  2. get_qid — paginate through actual facility records using the QueryID
"""

import logging
import re
import time
from typing import List, Dict

import requests

from config import Config
from enrichment import safe_get
from enrichment.firm_match import _prefix_match_is_trustworthy  # noqa: F401  (re-exported for tests)
from models import now_iso

logger = logging.getLogger(__name__)

DEFAULT_MAX_PAGES = 5  # cap pagination to avoid runaway requests

def _parse_penalty(raw_value) -> float:
    """Parse a penalty amount from various EPA formats ($1,234 or 1234)."""
    if not raw_value:
        return 0.0
    try:
        return float(str(raw_value).replace(",", "").replace("$", ""))
    except (ValueError, TypeError):
        return 0.0


def _is_violation_status(status) -> bool:
    """True for ECHO compliance statuses that report an actual violation.

    ECHO returns every facility that matches a name search, compliant or not,
    and the dominant status is "No Violation Identified". Only statuses that
    name a violation or noncompliance count; "Unknown", "Inactive" and
    "Terminated Permit" do not.
    """
    s = (status or "").strip().lower()
    if not s or s.startswith("no "):
        return False
    return "violation" in s or "noncompliance" in s


def _determine_violation_type(facility: dict, penalty: float = 0.0) -> str:
    """Name the statute a facility is in violation of.

    AIRFlag only says the facility holds an air permit, so it is not evidence
    of a Clean Air Act violation; the per-program compliance status is.
    """
    for program in ("CAA", "CWA", "RCRA", "SDWA"):
        if _is_violation_status(facility.get(f"{program}ComplianceStatus")):
            return program
    if penalty > 0 and (facility.get("CAALastPenaltyAmt") or facility.get("CAAPenalties")):
        return "CAA"  # penalty_amount is read from the CAA penalty fields
    return "environmental"


def _process_facility(
    facility: dict, company_name: str, seen_facilities: set, stats: dict | None = None
) -> dict | None:
    """Extract a violation dict from a single facility record, or None if not relevant."""
    fac_id = facility.get("RegistryID", "")
    if not fac_id or fac_id in seen_facilities:
        return None

    # Verify the facility's OWN registered name against the queried company.
    # ECHO's p_fn is a fuzzy facility-name search: querying a short name like
    # "Mesa" or "Angel" returns thousands of unrelated facilities, which used to
    # be attributed wholesale to the queried company (audit C2 — a Swiss
    # ministry ended up with 7,606 US EPA violations). Accept only facilities
    # whose name IS the company name or starts with it at a word boundary
    # ("CVS PHARMACY #1234" for "CVS Pharmacy"); reject everything else.
    fac_name = (facility.get("FacName") or "").strip()
    comp_lower = (company_name or "").strip().lower()
    fac_lower = fac_name.lower()
    if not fac_name or not comp_lower:
        return None
    if fac_lower == comp_lower:
        matched_by, match_confidence = "facility_name_verified", "high"
    elif fac_lower.startswith(comp_lower) and (
        len(fac_lower) == len(comp_lower) or not fac_lower[len(comp_lower)].isalnum()
    ):
        # Sharing a first word is not sharing an identity — see
        # _prefix_match_is_trustworthy.
        if not _prefix_match_is_trustworthy(comp_lower, fac_lower[len(comp_lower):]):
            if stats is not None:
                stats["weak_prefix_rejected"] = stats.get("weak_prefix_rejected", 0) + 1
            return None
        matched_by, match_confidence = "facility_name_prefix", "medium"
    else:
        return None

    seen_facilities.add(fac_id)

    compliance = facility.get("FacComplianceStatus", "") or ""
    penalty_raw = facility.get("CAALastPenaltyAmt") or facility.get("CAAPenalties") or 0
    last_inspection = facility.get("FacDateLastInspection", "") or ""

    penalty_float = _parse_penalty(penalty_raw)

    # A name match is not a violation. Publish only facilities whose status
    # reports one, or that were actually penalized; a compliant facility used
    # to be written as a HAS_EPA_VIOLATION edge just for existing.
    in_violation = _is_violation_status(compliance) or any(
        _is_violation_status(facility.get(f"{p}ComplianceStatus"))
        for p in ("CAA", "CWA", "RCRA", "SDWA")
    )
    if not in_violation and penalty_float <= 0:
        if stats is not None:
            stats["no_violation_skipped"] = stats.get("no_violation_skipped", 0) + 1
        return None

    return {
        "facility_id": fac_id,
        "company_name": company_name,
        "facility_name": fac_name,
        "matched_by": matched_by,
        "match_confidence": match_confidence,
        "violation_type": _determine_violation_type(facility, penalty_float),
        "compliance_status": compliance,
        "penalty_amount": penalty_float,
        "last_inspection": last_inspection,
        "registry_id": fac_id,
        "source": "epa_echo",
        "last_updated": now_iso(),
    }


def enrich(company_names: List[str], config: Config, on_progress=None) -> List[Dict]:
    """
    Search EPA ECHO for environmental violations by company.
    Returns list of EnvironmentalViolation dicts.

    Uses the two-step QID pattern:
      1. get_facilities (search) -> QueryID
      2. get_qid (paginate)     -> Facilities[]
    """
    session = requests.Session()
    session.headers.update({"User-Agent": "BoykETL/2.0"})

    all_violations = []
    seen_facilities = set()
    stats: Dict[str, int] = {}
    truncated_companies = 0
    max_pages = max(1, int(getattr(config, "epa_echo_max_pages_per_company", DEFAULT_MAX_PAGES) or DEFAULT_MAX_PAGES))
    page_size = max(1, int(getattr(config, "epa_echo_page_size", 50) or 50))

    for i, company_name in enumerate(company_names):
        # Step 1: Search for facilities — returns summary + QueryID
        search_url = f"{config.epa_echo_base}.get_facilities"
        search_params = {
            "output": "JSON",
            "p_fn": company_name,  # facility name search
            "p_act": "Y",         # active facilities only
        }
        search_data = safe_get(session, search_url, params=search_params, timeout=30)
        time.sleep(0.5)

        if not search_data:
            logger.debug(f"No search results for '{company_name}'")
            if on_progress:
                on_progress(company_name, i)
            continue

        results = search_data.get("Results", {})

        # Check for API errors
        if "Error" in results:
            logger.warning(f"EPA ECHO error for '{company_name}': {results['Error']}")
            if on_progress:
                on_progress(company_name, i)
            continue

        query_id = results.get("QueryID")
        query_rows = int(results.get("QueryRows", "0") or "0")

        if not query_id or query_rows == 0:
            logger.debug(f"No facilities found for '{company_name}' (rows={query_rows})")
            if on_progress:
                on_progress(company_name, i)
            continue

        logger.debug(f"EPA ECHO: '{company_name}' -> QID={query_id}, {query_rows} rows")

        # Step 2: Paginate through facility records using QueryID
        if query_rows > max_pages * page_size:
            truncated_companies += 1
            logger.warning(
                f"EPA ECHO: truncating '{company_name}' at {max_pages} pages x {page_size} rows "
                f"(reported rows={query_rows})"
            )

        for page_no in range(1, max_pages + 1):
            qid_url = f"{config.epa_echo_base}.get_qid"
            qid_params = {
                "output": "JSON",
                "qid": query_id,
                "pageno": page_no,
                "pagesize": page_size,
            }
            page_data = safe_get(session, qid_url, params=qid_params, timeout=30)
            time.sleep(0.5)

            if not page_data:
                break

            page_results = page_data.get("Results", {})

            if "Error" in page_results:
                logger.warning(f"EPA ECHO pagination error (QID={query_id}, page={page_no}): {page_results['Error']}")
                break

            facilities = page_results.get("Facilities", [])
            if not facilities:
                break

            for facility in facilities:
                violation = _process_facility(facility, company_name, seen_facilities, stats)
                if violation:
                    all_violations.append(violation)

            # Stop if we've retrieved all rows
            if page_no * page_size >= query_rows:
                break

        if on_progress:
            on_progress(company_name, i)

    logger.info(
        f"Stage 16: found {len(all_violations)} environmental violations from EPA ECHO "
        f"(truncated companies: {truncated_companies}, page cap: {max_pages}, page size: {page_size}, "
        f"weak-prefix facilities rejected: {stats.get('weak_prefix_rejected', 0)}, "
        f"compliant facilities skipped: {stats.get('no_violation_skipped', 0)})"
    )
    return all_violations
