"""
Boyk ETL Configuration
All settings loaded from environment variables with sensible defaults.
"""

import os
import logging
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

logger = logging.getLogger("etl.config")


# Map each stage to its required env vars (empty list = no key needed)
STAGE_REQUIREMENTS: Dict[int, List[str]] = {
    1:  [],                                        # Wikidata — free, no key
    2:  [],                                        # GLEIF — free, no key
    3:  [],                                        # OpenFoodFacts — free, no key
    4:  [],                                        # Wikidata product IDs — free, no key
    5:  ["LOGO_DEV_PUBLISHABLE_KEY"],               # Logo.dev hotlinks (publishable key)
    6:  ["SEC_USER_AGENT"],                         # SEC EDGAR (user agent required)
    7:  [],                                        # FEC corporate PACs — public bulk files, no key
    8:  ["SEC_USER_AGENT"],                         # SEC 13F (user agent required)
    10: ["FOLLOWTHEMONEY_API_KEY"],                 # FollowTheMoney state donations
    11: [],                                        # Violation Tracker — scrape, no key
    12: [],                                        # WikiRate — key optional
    13: ["OPEN_SUPPLY_HUB_API_KEY"],               # Open Supply Hub
    14: [],                                        # Wikidata extended — free, no key
    15: ["SEC_USER_AGENT"],                         # SEC proxy (user agent required)
    16: [],                                        # EPA ECHO — free, no key
    17: [],                                        # Subsidy Tracker — free, no key
    18: [],                                        # OSHA — bulk CSV, free
    19: [],                                        # USAspending — free API, no key
    20: [],                                        # CFPB complaints — free API, no key
    21: [],                                        # FDA recalls — free API, no key
    22: [],                                        # CPSC recalls — free API, no key
    23: [],                                        # ICIJ Offshore Leaks — bulk CSV, free
    24: ["UK_COMPANIES_HOUSE_API_KEY"],             # UK Companies House — free key required
    25: [],                                        # OFAC sanctions lists — public domain, no key
    27: [],                                        # Aggregate scores — internal, no API
}

# Human-readable stage names for logging
STAGE_NAMES: Dict[int, str] = {
    1:  "Wikidata Base Entities",
    2:  "GLEIF Legal Entities",
    3:  "OpenFoodFacts Products",
    4:  "Wikidata Product IDs",
    5:  "Logo.dev Logos (hotlinked)",
    6:  "SEC EDGAR Supply Chain",
    7:  "FEC Corporate PAC Contributions",
    8:  "SEC 13F Institutional Investors",
    10: "FollowTheMoney State Donations",
    11: "Violation Tracker Penalties",
    12: "WikiRate ESG Scores",
    13: "Open Supply Hub Facilities",
    14: "Wikidata Extended Properties",
    15: "SEC Proxy Compensation",
    16: "EPA ECHO Environmental",
    17: "Subsidy Tracker",
    18: "OSHA Workplace Violations",
    19: "USAspending Government Contracts",
    20: "CFPB Consumer Complaints",
    21: "FDA Recalls",
    22: "CPSC Product Recalls",
    23: "ICIJ Offshore Leaks",
    24: "UK Companies House",
    25: "OFAC Sanctions",
    26: "GDELT News Monitoring",
    27: "Aggregate Score Computation",
}

# Configurable company limits per stage (0 = no limit)
STAGE_LIMITS: Dict[int, int] = {
    3:  500,   # OpenFoodFacts — unreliable API
    6:  200,   # SEC EDGAR — rate limited
    7:  300,   # FEC — paginated, slow
    8:  500,   # SEC 13F — rate limited
    10: 200,   # FollowTheMoney
    11: 500,   # Violation Tracker — scraping
    12: 300,   # WikiRate
    13: 200,   # Open Supply Hub
    15: 100,   # SEC Proxy — complex parsing
    16: 300,   # EPA ECHO
    17: 300,   # Subsidy Tracker
    18: 0,     # OSHA — bulk CSV, no limit
    19: 500,   # USAspending
    20: 0,     # CFPB — bulk CSV, no limit (filter all 74K companies in one pass)
    21: 500,   # FDA
    22: 500,   # CPSC
    23: 0,     # ICIJ — bulk CSV, no limit
    24: 300,   # UK Companies House — rate limited
    25: 0,     # OFAC — bulk lists, every company screened in one pass
    27: 0,     # Aggregate — internal Cypher
}

# Stages that never run, even with --force-keys, and why. Remove an entry only
# once its reason is resolved (decided 2026-09-19).
RETIRED_STAGES: Dict[int, str] = {
    3:  "Open Food Facts API ran ~8 req/s against a 10 req/min limit; the off-ingest bulk build replaces it",
    11: "Good Jobs First license bars automated access (Violation Tracker)",
    15: "Executive pay for named individuals is personal data; needs a privacy review first",
    17: "Good Jobs First license bars automated access (Subsidy Tracker)",
    23: "ICIJ Offshore Leaks matched companies to offshore entities by name only",
    24: "Companies House PSC records are personal data about private individuals; needs a privacy review first",
    26: "GDELT news tone searched by company name (Shell, Apple, Target match unrelated stories) and scored "
        "only 36 companies; its API has answered 429 to every request since September. Removed 2026-09-29",
}

# Stage dependency graph — each stage requires these stages to have run first
STAGE_DEPENDENCIES: Dict[int, List[int]] = {
    3:  [1],
    4:  [1],
    5:  [1, 2],
    6:  [1, 2],
    7:  [1],
    8:  [1, 14],
    10: [1],
    11: [1],
    12: [1],
    13: [1],
    14: [1, 2],
    15: [1, 2],
    16: [1],
    17: [1],
    18: [1],
    19: [1],
    20: [1],
    21: [1],
    22: [1],
    23: [1],
    24: [1, 2],
    25: [1],
    26: [1],
    27: [1],
}


def check_stage_keys(stage_num: int) -> Tuple[bool, List[str]]:
    """
    Check if required environment variables are set for a given stage.

    Returns:
        (can_run, missing_keys) — can_run is True if all required keys are present.
    """
    required = STAGE_REQUIREMENTS.get(stage_num, [])
    if not required:
        return True, []
    missing = [k for k in required if not os.environ.get(k, "").strip()]
    return len(missing) == 0, missing


def check_all_stages() -> Dict[int, Tuple[bool, List[str]]]:
    """
    Check all stages and return a dict of {stage_num: (can_run, missing_keys)}.
    Also logs a summary.
    """
    results = {}
    runnable = []
    skipped = []

    for stage_num in sorted(STAGE_REQUIREMENTS.keys()):
        can_run, missing = check_stage_keys(stage_num)
        results[stage_num] = (can_run, missing)
        name = STAGE_NAMES.get(stage_num, f"Stage {stage_num}")
        if can_run:
            runnable.append(stage_num)
        else:
            skipped.append((stage_num, name, missing))

    logger.info(f"Stage readiness: {len(runnable)}/{len(STAGE_REQUIREMENTS)} stages can run")
    if skipped:
        logger.warning("Stages that will be SKIPPED due to missing keys:")
        for num, name, missing in skipped:
            logger.warning(f"  Stage {num:2d} ({name}): missing {', '.join(missing)}")

    return results


@dataclass
class Config:
    # Neo4j
    neo4j_uri: str = field(default_factory=lambda: os.getenv("NEO4J_URI", "neo4j+s://localhost:7687"))
    neo4j_user: str = field(default_factory=lambda: os.getenv("NEO4J_USER", "neo4j"))
    neo4j_password: str = field(default_factory=lambda: os.getenv("NEO4J_PASSWORD", "password"))
    neo4j_database: str = field(default_factory=lambda: os.getenv("NEO4J_DATABASE", "neo4j"))

    # S3 staging
    s3_bucket: str = field(default_factory=lambda: os.getenv("S3_BUCKET", "boyk-etl-staging"))
    s3_prefix: str = field(default_factory=lambda: os.getenv("S3_PREFIX", "staged"))

    # API keys (loaded from env, may be empty)
    logo_dev_publishable_key: str = field(default_factory=lambda: os.getenv("LOGO_DEV_PUBLISHABLE_KEY", ""))
    logo_dev_secret_key: str = field(default_factory=lambda: os.getenv("LOGO_DEV_SECRET_KEY", ""))
    fec_api_key: str = field(default_factory=lambda: os.getenv("FEC_API_KEY", ""))
    followthemoney_api_key: str = field(default_factory=lambda: os.getenv("FOLLOWTHEMONEY_API_KEY", ""))
    open_supply_hub_api_key: str = field(default_factory=lambda: os.getenv("OPEN_SUPPLY_HUB_API_KEY", ""))
    wikirate_api_key: str = field(default_factory=lambda: os.getenv("WIKIRATE_API_KEY", ""))

    # Batching
    batch_size: int = field(default_factory=lambda: int(os.getenv("ETL_BATCH_SIZE", "5000")))
    max_workers: int = field(default_factory=lambda: int(os.getenv("ETL_MAX_WORKERS", "4")))
    etl_stage_concurrency: int = field(default_factory=lambda: max(1, int(os.getenv("ETL_STAGE_CONCURRENCY", "1"))))
    etl_company_shard_count: int = field(default_factory=lambda: max(1, int(os.getenv("ETL_COMPANY_SHARD_COUNT", "1"))))
    etl_company_shard_index: int = field(default_factory=lambda: int(os.getenv("ETL_COMPANY_SHARD_INDEX", "0")))
    etl_rotate_capped_stages: bool = field(
        default_factory=lambda: os.getenv("ETL_ROTATE_CAPPED_STAGES", "1").strip().lower() not in ("0", "false", "no")
    )
    etl_audit_relationship_provenance: bool = field(
        default_factory=lambda: os.getenv("ETL_AUDIT_RELATIONSHIP_PROVENANCE", "1").strip().lower()
        not in ("0", "false", "no")
    )
    etl_fail_on_missing_relationship_provenance: bool = field(
        default_factory=lambda: os.getenv("ETL_FAIL_ON_MISSING_RELATIONSHIP_PROVENANCE", "0").strip().lower()
        not in ("0", "false", "no")
    )
    etl_backfill_relationship_provenance: bool = field(
        default_factory=lambda: os.getenv("ETL_BACKFILL_RELATIONSHIP_PROVENANCE", "0").strip().lower()
        not in ("0", "false", "no")
    )
    etl_provenance_audit_sample_limit: int = field(
        default_factory=lambda: max(1, int(os.getenv("ETL_PROVENANCE_AUDIT_SAMPLE_LIMIT", "20")))
    )
    neo4j_pool_size: int = field(default_factory=lambda: int(os.getenv("NEO4J_POOL_SIZE", "50")))
    gleif_api_batch_size: int = field(default_factory=lambda: int(os.getenv("GLEIF_BATCH_SIZE", "50")))
    gleif_api_workers: int = field(default_factory=lambda: int(os.getenv("GLEIF_WORKERS", "8")))
    wikidata_workers: int = field(default_factory=lambda: int(os.getenv("WIKIDATA_WORKERS", "6")))
    sec_rate_limit: float = field(default_factory=lambda: float(os.getenv("SEC_RATE_LIMIT", "0.12")))  # 10 req/sec

    # Logging
    log_level: str = field(default_factory=lambda: os.getenv("ETL_LOG_LEVEL", "INFO"))

    # Wikidata
    wikidata_endpoint: str = "https://query.wikidata.org/sparql"
    wikidata_user_agent: str = field(
        default_factory=lambda: os.getenv("WIKIDATA_USER_AGENT", "BoykETL/2.0 (https://boyk.org; contact@boyk.org)")
    )

    # GLEIF
    gleif_api_base: str = "https://api.gleif.org/api/v1"
    gleif_user_agent: str = field(
        default_factory=lambda: os.getenv("GLEIF_USER_AGENT", "boyk-etl/1.0")
    )

    # SEC EDGAR
    sec_edgar_base: str = "https://efts.sec.gov/LATEST"
    sec_edgar_submissions: str = "https://data.sec.gov/submissions"
    sec_user_agent: str = field(
        default_factory=lambda: os.getenv("SEC_USER_AGENT", "")
    )

    # FEC
    fec_api_base: str = "https://api.open.fec.gov/v1"
    fec_max_pages_per_company: int = field(default_factory=lambda: max(1, int(os.getenv("FEC_MAX_PAGES_PER_COMPANY", "3"))))

    # FollowTheMoney
    followthemoney_api_base: str = "https://api.followthemoney.org"

    # Violation Tracker
    violation_tracker_base: str = "https://violationtracker.goodjobsfirst.org"
    violation_tracker_user_agent: str = field(
        default_factory=lambda: os.getenv("VIOLATION_TRACKER_USER_AGENT", "boyk-etl/1.0")
    )
    violation_tracker_max_pages_per_company: int = field(
        default_factory=lambda: max(1, int(os.getenv("VIOLATION_TRACKER_MAX_PAGES_PER_COMPANY", "20")))
    )

    # WikiRate
    wikirate_api_base: str = "https://wikirate.org"

    # Open Supply Hub
    open_supply_hub_api_base: str = "https://opensupplyhub.org/api"
    open_supply_hub_page_size: int = field(default_factory=lambda: max(1, int(os.getenv("OPEN_SUPPLY_HUB_PAGE_SIZE", "50"))))
    open_supply_hub_max_pages_per_company: int = field(
        default_factory=lambda: max(1, int(os.getenv("OPEN_SUPPLY_HUB_MAX_PAGES_PER_COMPANY", "1")))
    )
    open_supply_hub_max_facilities_total: int = field(
        default_factory=lambda: max(1, int(os.getenv("OPEN_SUPPLY_HUB_MAX_FACILITIES_TOTAL", "4500")))
    )

    # Logo.dev (replaced Clearbit)
    logo_dev_base: str = "https://img.logo.dev"

    # No R2 settings for logos: logo.dev's free plan licenses hotlinking, not
    # storing copies, so stage 5 writes img.logo.dev URLs and uploads nothing.
    # The copies made before 2026-09-21 are archived in the private
    # boyk-backups bucket under logo-dev-archive-2026-09-21/.

    # OpenFoodFacts
    off_user_agent: str = field(
        default_factory=lambda: os.getenv("OFF_USER_AGENT", "boyk-etl/1.0 (contact@boyk.app)")
    )
    openfoodfacts_page_size: int = field(default_factory=lambda: max(1, int(os.getenv("OPENFOODFACTS_PAGE_SIZE", "100"))))
    openfoodfacts_max_pages_per_source: int = field(
        default_factory=lambda: max(1, int(os.getenv("OPENFOODFACTS_MAX_PAGES_PER_SOURCE", "1")))
    )

    # EPA ECHO (migrated to echodata.epa.gov, two-step QID pattern)
    epa_echo_base: str = "https://echodata.epa.gov/echo/echo_rest_services"
    epa_echo_page_size: int = field(default_factory=lambda: max(1, int(os.getenv("EPA_ECHO_PAGE_SIZE", "50"))))
    epa_echo_max_pages_per_company: int = field(
        default_factory=lambda: max(1, int(os.getenv("EPA_ECHO_MAX_PAGES_PER_COMPANY", "5")))
    )

    # Subsidy Tracker
    subsidy_tracker_base: str = "https://subsidytracker.goodjobsfirst.org"
    subsidy_tracker_max_pages_per_company: int = field(
        default_factory=lambda: max(1, int(os.getenv("SUBSIDY_TRACKER_MAX_PAGES_PER_COMPANY", "20")))
    )

    # OSHA (Stage 18) — bulk CSV
    osha_data_url: str = "https://enforcedata.dol.gov/views/data_summary/summary_data/osha_violation_current.csv.zip"
    osha_inspection_url: str = "https://enforcedata.dol.gov/views/data_summary/summary_data/osha_inspection_current.csv.zip"

    # USAspending (Stage 19)
    usaspending_api_base: str = "https://api.usaspending.gov/api/v2"
    usaspending_page_size: int = field(default_factory=lambda: max(1, int(os.getenv("USASPENDING_PAGE_SIZE", "50"))))
    usaspending_max_pages_per_company: int = field(
        default_factory=lambda: max(1, int(os.getenv("USASPENDING_MAX_PAGES_PER_COMPANY", "1")))
    )

    # CFPB (Stage 20)
    cfpb_bulk_csv_url: str = field(
        default_factory=lambda: os.getenv("CFPB_BULK_CSV_URL", "https://files.consumerfinance.gov/ccdb/complaints.csv.zip")
    )
    cfpb_max_complaints_per_company: int = field(
        default_factory=lambda: max(1, int(os.getenv("CFPB_MAX_COMPLAINTS_PER_COMPANY", "100")))
    )

    # FDA (Stage 21)
    fda_api_base: str = "https://api.fda.gov"
    fda_recall_page_size: int = field(default_factory=lambda: max(1, int(os.getenv("FDA_RECALL_PAGE_SIZE", "50"))))
    fda_recall_max_pages_per_endpoint: int = field(
        default_factory=lambda: max(1, int(os.getenv("FDA_RECALL_MAX_PAGES_PER_ENDPOINT", "1")))
    )

    # CPSC (Stage 22)
    cpsc_api_base: str = "https://www.saferproducts.gov/RestWebServices"

    # ICIJ Offshore Leaks (Stage 23)
    icij_data_url: str = "https://offshoreleaks-data.icij.org/offshoreleaks/csv/full-oldb.LATEST.zip"

    # UK Companies House (Stage 24)
    uk_ch_api_base: str = "https://api.company-information.service.gov.uk"
    uk_ch_api_key: str = field(default_factory=lambda: os.getenv("UK_COMPANIES_HOUSE_API_KEY", ""))
    uk_ch_search_items_per_page: int = field(
        default_factory=lambda: max(1, int(os.getenv("UK_CH_SEARCH_ITEMS_PER_PAGE", "5")))
    )
    uk_ch_max_company_matches_per_query: int = field(
        default_factory=lambda: max(1, int(os.getenv("UK_CH_MAX_COMPANY_MATCHES_PER_QUERY", "1")))
    )

    # OpenSanctions (Stage 25)
    opensanctions_api_base: str = "https://api.opensanctions.org"
    opensanctions_api_key: str = field(default_factory=lambda: os.getenv("OPENSANCTIONS_API_KEY", ""))


    # Stage control (no stage 9 — OpenSecrets discontinued April 2025)
    all_stages: List[int] = field(default_factory=lambda: [
        1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16, 17,
        18, 19, 20, 21, 22, 23, 24, 25, 26, 27
    ])

    # Cache dir. On Lambda the package root (./cache) is a read-only filesystem,
    # so default to /tmp/cache there — mirroring the checkpoint-dir handling in
    # run_etl.py. Without this the OSHA (stage 18) and ICIJ (stage 23) stages
    # failed 100% of runs with "[Errno 30] Read-only file system: './cache'".
    cache_dir: str = field(default_factory=lambda: os.getenv(
        "CACHE_DIR",
        "/tmp/cache" if os.getenv("AWS_LAMBDA_FUNCTION_NAME") else "./cache",
    ))

    def validate(self) -> bool:
        """
        Validate critical config. Returns True if pipeline can start at all.
        Non-critical missing keys are handled per-stage, not here.
        """
        errors = []

        # Neo4j is required — pipeline is useless without it
        if self.neo4j_password in ("", "password"):
            errors.append("NEO4J_PASSWORD is not set (still default)")
        if "localhost" in self.neo4j_uri and os.getenv("NEO4J_URI") is None:
            errors.append("NEO4J_URI is not set (using localhost default)")
        if self.etl_company_shard_index < 0:
            errors.append("ETL_COMPANY_SHARD_INDEX must be >= 0")

        if errors:
            for e in errors:
                logger.error(f"Config error: {e}")
            return False
        if self.etl_company_shard_index >= self.etl_company_shard_count:
            logger.warning(
                "ETL_COMPANY_SHARD_INDEX (%s) >= ETL_COMPANY_SHARD_COUNT (%s); "
                "the pipeline will wrap the shard index with modulo arithmetic",
                self.etl_company_shard_index,
                self.etl_company_shard_count,
            )
        return True
