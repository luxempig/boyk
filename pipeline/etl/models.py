"""
Boyk ETL Data Models
Dataclasses for all node and relationship types with provenance tracking.
"""

import json
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import List, Optional, Dict, Any


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class SourceEntry:
    """Single provenance record for a data field."""
    source: str
    field_name: str
    value: Any
    fetched: str = field(default_factory=now_iso)
    confidence: str = "high"

    def to_dict(self) -> dict:
        return asdict(self)


class ProvenanceMixin:
    """Mixin providing multi-source provenance helpers."""

    def _init_provenance(self):
        if not hasattr(self, "_source_entries"):
            self._source_entries: List[SourceEntry] = []
        if not hasattr(self, "data_sources"):
            self.data_sources: List[str] = []

    def add_source(self, source: str, field_name: str, value: Any, confidence: str = "high"):
        self._init_provenance()
        self._source_entries.append(SourceEntry(
            source=source, field_name=field_name, value=value, confidence=confidence
        ))
        if source not in self.data_sources:
            self.data_sources.append(source)

    def get_sources_json(self) -> str:
        self._init_provenance()
        return json.dumps([e.to_dict() for e in self._source_entries])

    @property
    def source_count(self) -> int:
        self._init_provenance()
        return len(set(self.data_sources))


# ── Core Entities ──────────────────────────────────────────────

@dataclass
class Company:
    name: str
    lei: Optional[str] = None
    wikidata_id: Optional[str] = None
    cik: Optional[str] = None
    legal_name: Optional[str] = None
    jurisdiction: Optional[str] = None
    country: Optional[str] = None
    industry: Optional[str] = None
    hq_city: Optional[str] = None
    hq_country: Optional[str] = None
    website: Optional[str] = None
    logo_url: Optional[str] = None
    founded: Optional[str] = None
    employees: Optional[int] = None
    revenue: Optional[float] = None
    stock_exchange: Optional[str] = None
    ticker: Optional[str] = None
    isin: Optional[str] = None
    data_sources: List[str] = field(default_factory=list)
    sources_json: str = "[]"
    last_updated: str = field(default_factory=now_iso)

    _source_entries: List[SourceEntry] = field(default_factory=list, repr=False)

    def add_source(self, source: str, field_name: str, value: Any, confidence: str = "high"):
        self._source_entries.append(SourceEntry(source=source, field_name=field_name, value=value, confidence=confidence))
        if source not in self.data_sources:
            self.data_sources.append(source)
        self.sources_json = json.dumps([e.to_dict() for e in self._source_entries])

    @property
    def source_count(self) -> int:
        return len(set(self.data_sources))

    def to_dict(self) -> dict:
        d = {}
        for k, v in asdict(self).items():
            if k.startswith("_") or v is None:
                continue
            d[k] = v
        d.pop("_source_entries", None)
        d["source_count"] = self.source_count
        return d


@dataclass
class Brand:
    name: str
    wikidata_id: Optional[str] = None
    website: Optional[str] = None
    logo_url: Optional[str] = None
    data_sources: List[str] = field(default_factory=list)
    sources_json: str = "[]"
    last_updated: str = field(default_factory=now_iso)

    _source_entries: List[SourceEntry] = field(default_factory=list, repr=False)

    def add_source(self, source: str, field_name: str, value: Any, confidence: str = "high"):
        self._source_entries.append(SourceEntry(source=source, field_name=field_name, value=value, confidence=confidence))
        if source not in self.data_sources:
            self.data_sources.append(source)
        self.sources_json = json.dumps([e.to_dict() for e in self._source_entries])

    def to_dict(self) -> dict:
        d = {k: v for k, v in asdict(self).items() if not k.startswith("_") and v is not None}
        d.pop("_source_entries", None)
        return d


@dataclass
class Product:
    name: str
    barcode: Optional[str] = None
    asin: Optional[str] = None
    upc: Optional[str] = None
    category: Optional[str] = None
    brand_name: Optional[str] = None
    data_sources: List[str] = field(default_factory=list)
    sources_json: str = "[]"
    last_updated: str = field(default_factory=now_iso)

    _source_entries: List[SourceEntry] = field(default_factory=list, repr=False)

    def add_source(self, source: str, field_name: str, value: Any, confidence: str = "high"):
        self._source_entries.append(SourceEntry(source=source, field_name=field_name, value=value, confidence=confidence))
        if source not in self.data_sources:
            self.data_sources.append(source)
        self.sources_json = json.dumps([e.to_dict() for e in self._source_entries])

    def to_dict(self) -> dict:
        d = {k: v for k, v in asdict(self).items() if not k.startswith("_") and v is not None}
        d.pop("_source_entries", None)
        return d


@dataclass
class Person:
    name: str
    wikidata_id: Optional[str] = None
    fec_id: Optional[str] = None
    role: Optional[str] = None
    total_compensation: Optional[float] = None
    base_salary: Optional[float] = None
    stock_awards: Optional[float] = None
    comp_fiscal_year: Optional[str] = None
    data_sources: List[str] = field(default_factory=list)
    sources_json: str = "[]"
    last_updated: str = field(default_factory=now_iso)

    _source_entries: List[SourceEntry] = field(default_factory=list, repr=False)

    def add_source(self, source: str, field_name: str, value: Any, confidence: str = "high"):
        self._source_entries.append(SourceEntry(source=source, field_name=field_name, value=value, confidence=confidence))
        if source not in self.data_sources:
            self.data_sources.append(source)
        self.sources_json = json.dumps([e.to_dict() for e in self._source_entries])

    def to_dict(self) -> dict:
        d = {k: v for k, v in asdict(self).items() if not k.startswith("_") and v is not None}
        d.pop("_source_entries", None)
        return d


@dataclass
class Politician:
    name: str
    fec_id: Optional[str] = None
    party: Optional[str] = None
    state: Optional[str] = None
    office: Optional[str] = None
    data_sources: List[str] = field(default_factory=list)
    sources_json: str = "[]"
    last_updated: str = field(default_factory=now_iso)

    def to_dict(self) -> dict:
        return {k: v for k, v in asdict(self).items() if v is not None}


# ── Enrichment Entities ────────────────────────────────────────

@dataclass
class Violation:
    case_id: str
    company_name: str
    agency: str
    offense_type: str
    penalty_amount: float
    year: int
    description: Optional[str] = None
    source: str = "violation_tracker"
    last_updated: str = field(default_factory=now_iso)

    def to_dict(self) -> dict:
        return {k: v for k, v in asdict(self).items() if v is not None}


@dataclass
class EnvironmentalViolation:
    facility_id: str
    company_name: str
    violation_type: Optional[str] = None
    compliance_status: Optional[str] = None
    penalty_amount: Optional[float] = None
    last_inspection: Optional[str] = None
    registry_id: Optional[str] = None
    source: str = "epa_echo"
    last_updated: str = field(default_factory=now_iso)

    def to_dict(self) -> dict:
        return {k: v for k, v in asdict(self).items() if v is not None}


@dataclass
class LobbyingRecord:
    company_name: str
    year: int
    total_spent: float
    issues: List[str] = field(default_factory=list)
    num_lobbyists: int = 0
    source: str = "opensecrets"
    last_updated: str = field(default_factory=now_iso)

    def to_dict(self) -> dict:
        return {k: v for k, v in asdict(self).items() if v is not None}


@dataclass
class ESGScore:
    company_name: str
    metric_name: str
    value: Any
    year: Optional[int] = None
    designer: Optional[str] = None
    methodology: Optional[str] = None
    source: str = "wikirate"
    last_updated: str = field(default_factory=now_iso)

    def to_dict(self) -> dict:
        return {k: v for k, v in asdict(self).items() if v is not None}


@dataclass
class Facility:
    os_id: str
    name: str
    country: str
    address: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    num_workers: Optional[int] = None
    product_types: List[str] = field(default_factory=list)
    company_name: Optional[str] = None
    source: str = "open_supply_hub"
    last_updated: str = field(default_factory=now_iso)

    def to_dict(self) -> dict:
        return {k: v for k, v in asdict(self).items() if v is not None}


@dataclass
class Subsidy:
    company_name: str
    subsidy_type: Optional[str] = None
    amount: Optional[float] = None
    year: Optional[int] = None
    state: Optional[str] = None
    program_name: Optional[str] = None
    awarding_agency: Optional[str] = None
    source: str = "subsidy_tracker"
    last_updated: str = field(default_factory=now_iso)

    def to_dict(self) -> dict:
        return {k: v for k, v in asdict(self).items() if v is not None}


@dataclass
class Recall:
    recall_id: str
    company_name: str
    product_name: Optional[str] = None
    reason: Optional[str] = None
    classification: Optional[str] = None
    status: Optional[str] = None
    date: Optional[str] = None
    agency: str = "fda"
    source: str = "fda"
    last_updated: str = field(default_factory=now_iso)

    def to_dict(self) -> dict:
        return {k: v for k, v in asdict(self).items() if v is not None}


@dataclass
class ConsumerComplaint:
    complaint_id: str
    company_name: str
    product: Optional[str] = None
    issue: Optional[str] = None
    sub_issue: Optional[str] = None
    state: Optional[str] = None
    date_received: Optional[str] = None
    company_response: Optional[str] = None
    timely_response: Optional[bool] = None
    consumer_disputed: Optional[bool] = None
    source: str = "cfpb"
    last_updated: str = field(default_factory=now_iso)

    def to_dict(self) -> dict:
        return {k: v for k, v in asdict(self).items() if v is not None}


@dataclass
class GovernmentContract:
    award_id: str
    company_name: str
    agency: Optional[str] = None
    amount: Optional[float] = None
    description: Optional[str] = None
    naics_code: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    contract_type: Optional[str] = None
    source: str = "usaspending"
    last_updated: str = field(default_factory=now_iso)

    def to_dict(self) -> dict:
        return {k: v for k, v in asdict(self).items() if v is not None}


@dataclass
class OffshoreEntity:
    icij_id: str
    name: str
    jurisdiction: Optional[str] = None
    incorporation_date: Optional[str] = None
    inactivation_date: Optional[str] = None
    status: Optional[str] = None
    investigation: Optional[str] = None
    company_name: Optional[str] = None
    source: str = "icij"
    last_updated: str = field(default_factory=now_iso)

    def to_dict(self) -> dict:
        return {k: v for k, v in asdict(self).items() if v is not None}


# ── Relationship Models ────────────────────────────────────────

@dataclass
class Relationship:
    """Generic relationship with provenance."""
    from_id: str          # identifier of source node (LEI, wikidata_id, name)
    from_label: str       # node label (Company, Brand, Person)
    from_field: str       # field used for matching (lei, wikidata_id, name)
    to_id: str
    to_label: str
    to_field: str
    rel_type: str         # SUBSIDIARY_OF, DONATED_TO, etc.
    properties: Dict[str, Any] = field(default_factory=dict)
    source: str = ""
    corroborated_by: List[str] = field(default_factory=list)
    confidence: str = "high"

    def to_dict(self) -> dict:
        d = asdict(self)
        d["properties"]["source"] = self.source
        d["properties"]["corroborated_by"] = self.corroborated_by
        d["properties"]["confidence"] = self.confidence
        d["properties"]["last_confirmed"] = now_iso()
        return d
