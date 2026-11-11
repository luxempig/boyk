"""Tests for new ETL stages 18-27 — enrichment modules and neo4j_writer methods."""

import json
import os
from unittest.mock import MagicMock, patch, call
import pytest

from config import Config, STAGE_LIMITS, STAGE_DEPENDENCIES, STAGE_NAMES
from company_resolver import CompanyResolver


def _test_resolver(name="Test", lei="L_TEST"):
    """A resolver that maps a single test company name to an identity."""
    return CompanyResolver([{"name": name, "lei": lei, "wikidata_id": None}])


@pytest.fixture
def mock_config():
    config = MagicMock(spec=Config)
    config.neo4j_uri = "bolt://localhost:7687"
    config.neo4j_user = "neo4j"
    config.neo4j_password = "test"
    config.neo4j_database = "neo4j"
    config.neo4j_pool_size = 4
    config.batch_size = 500
    config.cache_dir = "/tmp/boyk-test-cache"
    config.osha_data_url = "https://example.com/osha.zip"
    config.osha_inspection_url = "https://example.com/osha_insp.zip"
    config.usaspending_api_base = "https://api.usaspending.gov/api/v2"
    config.usaspending_page_size = 50
    config.usaspending_max_pages_per_company = 1
    config.cfpb_api_base = "https://www.consumerfinance.gov/data-research/consumer-complaints/search/api/v1"
    config.cfpb_max_complaints_per_company = 100
    config.fda_api_base = "https://api.fda.gov"
    config.fda_recall_page_size = 50
    config.fda_recall_max_pages_per_endpoint = 1
    config.cpsc_api_base = "https://www.saferproducts.gov/RestWebServices"
    config.icij_data_url = "https://example.com/icij.zip"
    config.uk_ch_api_base = "https://api.company-information.service.gov.uk"
    config.uk_ch_api_key = "test-key"
    config.uk_ch_search_items_per_page = 5
    config.uk_ch_max_company_matches_per_query = 1
    config.opensanctions_api_base = "https://api.opensanctions.org"
    config.opensanctions_api_key = "test-key"
    config.fec_max_pages_per_company = 10
    config.violation_tracker_max_pages_per_company = 20
    config.subsidy_tracker_max_pages_per_company = 20
    config.epa_echo_page_size = 50
    config.epa_echo_max_pages_per_company = 5
    config.openfoodfacts_page_size = 100
    config.openfoodfacts_max_pages_per_source = 1
    config.open_supply_hub_page_size = 50
    config.open_supply_hub_max_pages_per_company = 1
    config.open_supply_hub_max_facilities_total = 4500
    config.etl_stage_concurrency = 1
    config.etl_company_shard_count = 1
    config.etl_company_shard_index = 0
    config.etl_rotate_capped_stages = True
    return config


@pytest.fixture
def writer(mock_config):
    from neo4j_writer import Neo4jWriter
    with patch("neo4j_writer.GraphDatabase") as mock_gdb:
        mock_driver = MagicMock()
        mock_gdb.driver.return_value = mock_driver
        w = Neo4jWriter(mock_config)
        yield w


# ── Config Tests ────────────────────────────────────────────

class TestConfigV2:
    def test_new_stages_in_requirements(self):
        from config import STAGE_REQUIREMENTS
        for stage in [18, 19, 20, 21, 22, 23, 24, 25, 27]:   # 26 (GDELT) removed 2026-09-29
            assert stage in STAGE_REQUIREMENTS, f"Stage {stage} missing from STAGE_REQUIREMENTS"

    def test_new_stages_in_names(self):
        for stage in [18, 19, 20, 21, 22, 23, 24, 25, 26, 27]:
            assert stage in STAGE_NAMES, f"Stage {stage} missing from STAGE_NAMES"

    def test_gdelt_stage_is_removed_with_a_reason(self):
        from config import RETIRED_STAGES, STAGE_REQUIREMENTS
        assert 26 in RETIRED_STAGES and "GDELT" in RETIRED_STAGES[26]
        assert 26 not in STAGE_REQUIREMENTS

    def test_stage_limits_defined(self):
        for stage in [18, 19, 20, 21, 22, 23, 24, 25, 27]:   # 26 (GDELT) removed 2026-09-29
            assert stage in STAGE_LIMITS, f"Stage {stage} missing from STAGE_LIMITS"

    def test_stage_dependencies_defined(self):
        for stage in [18, 19, 20, 21, 22, 23, 24, 25, 26, 27]:
            assert stage in STAGE_DEPENDENCIES, f"Stage {stage} missing from STAGE_DEPENDENCIES"
        # All new stages depend on stage 1
        for stage in [18, 19, 20, 21, 22, 23, 24, 25, 26, 27]:
            assert 1 in STAGE_DEPENDENCIES[stage]

    def test_uk_ch_requires_api_key(self):
        from config import STAGE_REQUIREMENTS
        assert "UK_COMPANIES_HOUSE_API_KEY" in STAGE_REQUIREMENTS[24]

    def test_bulk_stages_have_no_limit(self):
        assert STAGE_LIMITS[18] == 0  # OSHA bulk CSV
        assert STAGE_LIMITS[23] == 0  # ICIJ bulk CSV
        assert STAGE_LIMITS[27] == 0  # Aggregates


# ── Neo4j Writer Tests ──────────────────────────────────────

class TestMergeRecalls:
    def test_query_uses_merge(self, writer):
        writer._run_identity_partitioned = MagicMock()
        writer.merge_recalls([{
            "recall_id": "FDA-123", "product_name": "Test",
            "company_name": "TestCo", "reason": "Contamination",
            "classification": "Class I", "status": "Ongoing",
            "date": "2024-01-01", "agency": "FDA",
            "source": "fda", "last_updated": "2024-01-01",
        }], _test_resolver("TestCo"))
        query = writer._run_identity_partitioned.call_args[0][0]
        assert "MERGE" in query
        assert "recall_id: row.recall_id" in query
        assert "RECALLED_PRODUCT" in query
        assert "Company {name:" not in query

    def test_empty_list_is_noop(self, writer):
        writer._run_identity_partitioned = MagicMock()
        writer.merge_recalls([], _test_resolver("TestCo"))
        writer._run_identity_partitioned.assert_called_once_with(
            writer._run_identity_partitioned.call_args[0][0], [], "recalls"
        )


class TestMergeConsumerComplaints:
    def test_query_uses_merge(self, writer):
        writer._run_identity_partitioned = MagicMock()
        writer.merge_consumer_complaints([{
            "complaint_id": "12345", "company_name": "TestCo",
            "product": "Credit card", "issue": "Billing",
            "sub_issue": "", "state": "CA",
            "date_received": "2024-01-01", "company_response": "Closed",
            "timely_response": True, "consumer_disputed": False,
            "source": "cfpb", "last_updated": "2024-01-01",
        }], _test_resolver("TestCo"))
        query = writer._run_identity_partitioned.call_args[0][0]
        assert "MERGE" in query
        assert "complaint_id: row.complaint_id" in query
        assert "HAS_COMPLAINT" in query
        assert "Company {name:" not in query


class TestMergeGovernmentContracts:
    def test_query_uses_merge(self, writer):
        writer._run_identity_partitioned = MagicMock()
        writer.merge_government_contracts([{
            "award_id": "AWD-001", "company_name": "TestCo",
            "agency": "DOD", "amount": 1000000,
            "description": "Test contract", "naics_code": "541511",
            "start_date": "2024-01-01", "end_date": "2025-01-01",
            "contract_type": "Fixed-price",
            "source": "usaspending", "last_updated": "2024-01-01",
        }], _test_resolver("TestCo"))
        query = writer._run_identity_partitioned.call_args[0][0]
        assert "MERGE" in query
        assert "AWARDED_CONTRACT" in query
        assert "Company {name:" not in query
        # The node key must be (award_id, agency). award_id alone is a per-agency
        # PIID fragment, and the DB constraint is composite — a merge key that
        # disagrees with the constraint fails every write at runtime.
        assert "MERGE (gc:GovernmentContract {award_id: row.award_id, agency: row.agency})" in query
        # recipient_name is written, but must NOT be part of the merge key: the
        # 82K existing nodes predate that property and would never re-match.
        assert "recipient_name: row.recipient_name" not in query
        assert "gc.recipient_name = row.recipient_name" in query


class TestMergeOffshoreEntities:
    def test_query_uses_merge(self, writer):
        writer._run_identity_partitioned = MagicMock()
        writer.merge_offshore_entities([{
            "icij_id": "ICIJ-001", "name": "Offshore Corp",
            "jurisdiction": "British Virgin Islands",
            "incorporation_date": "2010-01-01",
            "inactivation_date": "", "status": "Active",
            "investigation": "panama_papers",
            "company_name": "TestCo",
            "source": "icij", "last_updated": "2024-01-01",
        }], _test_resolver("TestCo"))
        query = writer._run_identity_partitioned.call_args[0][0]
        assert "MERGE" in query
        assert "icij_id: row.icij_id" in query
        assert "LINKED_TO_OFFSHORE" in query
        assert "Company {name:" not in query

    def test_null_company_is_quarantined(self, writer):
        # A null / unresolvable company name is quarantined (no edge written)
        # by partition_rows — no longer relies on a Cypher WHERE guard.
        writer._run_identity_partitioned = MagicMock()
        writer.merge_offshore_entities([{
            "icij_id": "ICIJ-002", "name": "Unmatched Corp",
            "jurisdiction": "Caymans",
            "incorporation_date": "", "inactivation_date": "",
            "status": "", "investigation": "pandora_papers",
            "company_name": None,
            "source": "icij", "last_updated": "2024-01-01",
        }], _test_resolver("TestCo"))
        rows = writer._run_identity_partitioned.call_args[0][1]
        assert rows == []


class TestAggregateScores:
    def test_runs_all_queries(self, writer):
        mock_session = MagicMock()
        mock_result = MagicMock()
        mock_summary = MagicMock()
        mock_summary.counters.properties_set = 5
        mock_result.consume.return_value = mock_summary
        mock_session.run.return_value = mock_result
        writer.driver.session.return_value.__enter__ = MagicMock(return_value=mock_session)
        writer.driver.session.return_value.__exit__ = MagicMock(return_value=False)

        writer.update_aggregate_scores()

        # One query per aggregate (violation + EPA penalties share total_penalties)
        assert mock_session.run.call_count == len(writer._AGGREGATES) == 6


class TestSupersededConstraintMigration:
    """The swap must never leave GovernmentContract with no uniqueness at all."""

    def _session_reporting(self, writer, constraint_names):
        mock_session = MagicMock()
        mock_session.run.return_value = [{"name": n} for n in constraint_names]
        writer.driver.session.return_value.__enter__ = MagicMock(return_value=mock_session)
        writer.driver.session.return_value.__exit__ = MagicMock(return_value=False)
        return mock_session

    def test_drops_old_constraint_once_replacement_is_live(self, writer):
        session = self._session_reporting(writer, ["contract_award", "contract_award_agency"])
        writer._migrate_superseded_constraints([])
        assert any(
            "DROP CONSTRAINT contract_award IF EXISTS" in c[0][0]
            for c in session.run.call_args_list
        ), "Superseded constraint should be dropped once its replacement exists"

    def test_keeps_old_constraint_when_replacement_is_absent(self, writer):
        session = self._session_reporting(writer, ["contract_award"])
        writer._migrate_superseded_constraints(["CREATE CONSTRAINT contract_award_agency"])
        assert not any(
            "DROP CONSTRAINT" in c[0][0] for c in session.run.call_args_list
        ), "Dropping the old key while the new one is missing leaves the label unconstrained"

    def test_noop_when_old_constraint_already_gone(self, writer):
        session = self._session_reporting(writer, ["contract_award_agency"])
        writer._migrate_superseded_constraints([])
        assert not any("DROP CONSTRAINT" in c[0][0] for c in session.run.call_args_list)


class TestNewConstraintsAndIndexes:
    def test_includes_new_constraints(self, writer):
        mock_session = MagicMock()
        writer.driver.session.return_value.__enter__ = MagicMock(return_value=mock_session)
        writer.driver.session.return_value.__exit__ = MagicMock(return_value=False)

        writer.setup_constraints_and_indexes()

        run_calls = mock_session.run.call_args_list
        statements = [c[0][0] for c in run_calls]

        assert any("recall_id" in s for s in statements), "Missing recall_id constraint"
        assert any("complaint_id" in s for s in statements), "Missing complaint_id constraint"
        assert any(
            "(gc.award_id, gc.agency) IS UNIQUE" in s for s in statements
        ), "GovernmentContract must be keyed on (award_id, agency), not award_id alone"
        assert not any(
            "REQUIRE gc.award_id IS UNIQUE" in s for s in statements
        ), "The single-property award_id constraint collapses unrelated awards"
        assert any("offshore_icij" in s for s in statements), "Missing offshore_icij constraint"

    def test_includes_new_indexes(self, writer):
        mock_session = MagicMock()
        writer.driver.session.return_value.__enter__ = MagicMock(return_value=mock_session)
        writer.driver.session.return_value.__exit__ = MagicMock(return_value=False)

        writer.setup_constraints_and_indexes()

        run_calls = mock_session.run.call_args_list
        statements = [c[0][0] for c in run_calls]

        # Current schema favors date + lookup indexes used by API queries
        assert any("recall_date" in s for s in statements), "Missing recall_date index"
        assert any("complaint_date" in s for s in statements), "Missing complaint_date index"
        assert any("product_upc" in s for s in statements), "Missing product_upc index"
        assert any("politician_name" in s for s in statements), "Missing politician_name index"
        assert any("violation_year" in s for s in statements), "Missing violation_year index"


class TestStatsIncludesNewTypes:
    def test_stats_query_has_new_types(self, writer):
        mock_session = MagicMock()
        mock_result = MagicMock()
        mock_result.__iter__ = MagicMock(return_value=iter([]))
        mock_session.run.return_value = mock_result
        writer.driver.session.return_value.__enter__ = MagicMock(return_value=mock_session)
        writer.driver.session.return_value.__exit__ = MagicMock(return_value=False)

        writer.get_stats()

        query = mock_session.run.call_args[0][0]
        assert "Recall" in query
        assert "ConsumerComplaint" in query
        assert "GovernmentContract" in query
        assert "OffshoreEntity" in query


class TestUKCompaniesHouseWrites:
    def test_updates_registration_fields_on_existing_company(self, writer):
        writer._run_identity_partitioned = MagicMock()
        writer.update_uk_company_registrations([{
            "name": "TestCo UK",
            "uk_company_number": "12345678",
            "uk_company_status": "active",
            "uk_company_type": "ltd",
            "uk_registered_address": "London",
            "date_of_creation": "2020-01-01",
            "data_sources": ["uk_companies_house"],
            "last_updated": "2026-02-25T00:00:00Z",
        }], _test_resolver("TestCo UK"))
        query = writer._run_identity_partitioned.call_args[0][0]
        rows = writer._run_identity_partitioned.call_args[0][1]
        assert "Company {name:" not in query
        assert writer.COMPANY_MATCH_TOKEN in query
        assert "uk_company_number" in query
        assert "uk_registered_address" in query
        assert "date_of_creation" in query
        assert rows[0]["company_key"] == "L_TEST"

    def test_merges_psc_people_and_relationships(self, writer):
        writer._run_identity_partitioned = MagicMock()
        writer.merge_uk_psc_relationships([{
            "person_name": "Jane Example",
            "company_name": "TestCo UK",
            "role": "significant_control",
            "natures_of_control": ["ownership-of-shares-75-to-100-percent"],
            "nationality": "British",
            "country_of_residence": "United Kingdom",
            "source": "uk_companies_house",
            "last_updated": "2026-02-25T00:00:00Z",
        }], _test_resolver("TestCo UK"))
        query = writer._run_identity_partitioned.call_args[0][0]
        assert "MERGE (p:Person {name: row.person_name})" in query
        assert "Company {name:" not in query
        assert writer.COMPANY_MATCH_TOKEN in query
        assert "HAS_SIGNIFICANT_CONTROL_OVER" in query
        assert "natures_of_control" in query


class TestCompanySelectionQueries:
    def test_company_names_query_is_distinct_and_sorted(self, writer):
        mock_session = MagicMock()
        mock_result = MagicMock()
        mock_result.__iter__ = MagicMock(return_value=iter([]))
        mock_session.run.return_value = mock_result
        writer.driver.session.return_value.__enter__ = MagicMock(return_value=mock_session)
        writer.driver.session.return_value.__exit__ = MagicMock(return_value=False)

        writer.get_all_company_names()

        query = mock_session.run.call_args[0][0]
        assert "RETURN DISTINCT c.name AS name" in query
        assert "ORDER BY" in query


# ── Models Tests ────────────────────────────────────────────

class TestNewModels:
    def test_recall_model(self):
        from models import Recall
        r = Recall(recall_id="FDA-123", company_name="Test", product_name="Widget")
        d = r.to_dict()
        assert d["recall_id"] == "FDA-123"
        assert d["company_name"] == "Test"
        assert d["agency"] == "fda"

    def test_consumer_complaint_model(self):
        from models import ConsumerComplaint
        cc = ConsumerComplaint(complaint_id="CC-1", company_name="Bank", product="Credit card")
        d = cc.to_dict()
        assert d["complaint_id"] == "CC-1"
        assert d["source"] == "cfpb"

    def test_government_contract_model(self):
        from models import GovernmentContract
        gc = GovernmentContract(award_id="AWD-1", company_name="Defense Corp", amount=1e6)
        d = gc.to_dict()
        assert d["award_id"] == "AWD-1"
        assert d["amount"] == 1e6

    def test_offshore_entity_model(self):
        from models import OffshoreEntity
        oe = OffshoreEntity(icij_id="ICIJ-1", name="Shell Corp", jurisdiction="BVI")
        d = oe.to_dict()
        assert d["icij_id"] == "ICIJ-1"
        assert d["source"] == "icij"


# ── Enrichment Module Tests ────────────────────────────────

class TestOshaEnrichment:
    @patch("enrichment.osha_violations._download_and_extract_csv")
    def test_returns_empty_on_download_failure(self, mock_download, mock_config):
        from enrichment.osha_violations import enrich
        mock_download.return_value = ""
        result = enrich(["Apple Inc"], mock_config)
        assert result == []


class TestUsaspendingEnrichment:
    @patch("enrichment.usaspending.requests.Session")
    def test_returns_contracts(self, mock_session_cls, mock_config):
        from enrichment.usaspending import enrich
        mock_session = MagicMock()
        mock_session_cls.return_value = mock_session
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "results": [{
                "Award ID": "AWD-001",
                "Recipient Name": "Apple Inc",
                "Awarding Agency": "DOD",
                "Award Amount": 1000000,
                "Description": "Test",
                "NAICS Code": "541511",
                "Start Date": "2024-01-01",
                "End Date": "2025-01-01",
                "Contract Award Type": "Fixed-price",
            }]
        }
        mock_session.post.return_value = mock_resp

        result = enrich(["Apple Inc"], mock_config)
        assert len(result) == 1
        assert result[0]["award_id"] == "AWD-001"
        assert result[0]["source"] == "usaspending"


def _make_cfpb_zip(rows):
    """Build an in-memory ZIP containing a CFPB-style complaints.csv."""
    import io, csv, zipfile
    header = [
        "Complaint ID", "Company", "Product", "Issue", "Sub-issue",
        "State", "Date received", "Company response to consumer",
        "Timely response?", "Consumer disputed?",
    ]
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=header)
    writer.writeheader()
    for row in rows:
        writer.writerow(row)
    csv_bytes = buf.getvalue().encode("utf-8")
    zip_buf = io.BytesIO()
    with zipfile.ZipFile(zip_buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("complaints.csv", csv_bytes)
    zip_buf.seek(0)
    return zip_buf.read()


class TestCfpbEnrichment:
    @patch("enrichment.cfpb_complaints._download_zip_bytes")
    def test_returns_complaints(self, mock_download, mock_config):
        from enrichment.cfpb_complaints import enrich
        mock_download.return_value = _make_cfpb_zip([{
            "Complaint ID": "12345",
            "Company": "TestBank",
            "Product": "Credit card",
            "Issue": "Billing disputes",
            "Sub-issue": "",
            "State": "CA",
            "Date received": "2024-01-01",
            "Company response to consumer": "Closed with explanation",
            "Timely response?": "Yes",
            "Consumer disputed?": "No",
        }])
        result = enrich(["TestBank"], mock_config)
        assert len(result) == 1
        assert result[0]["complaint_id"] == "12345"
        assert result[0]["company_name"] == "TestBank"
        assert result[0]["source"] == "cfpb"
        assert result[0]["timely_response"] is True
        assert result[0]["consumer_disputed"] is False

    @patch("enrichment.cfpb_complaints._download_zip_bytes")
    def test_name_normalization_matches(self, mock_download, mock_config):
        from enrichment.cfpb_complaints import enrich
        mock_download.return_value = _make_cfpb_zip([{
            "Complaint ID": "99999",
            "Company": "WELLS FARGO & COMPANY",
            "Product": "Mortgage",
            "Issue": "Loan servicing",
            "Sub-issue": "",
            "State": "TX",
            "Date received": "2024-02-01",
            "Company response to consumer": "Closed with non-monetary relief",
            "Timely response?": "Yes",
            "Consumer disputed?": "Yes",
        }])
        result = enrich(["Wells Fargo Inc."], mock_config)
        assert len(result) == 1
        assert result[0]["complaint_id"] == "99999"
        assert result[0]["company_name"] == "Wells Fargo Inc."

    @patch("enrichment.cfpb_complaints._download_zip_bytes")
    def test_max_complaints_per_company_honored(self, mock_download, mock_config):
        from enrichment.cfpb_complaints import enrich
        mock_config.cfpb_max_complaints_per_company = 2
        rows = []
        for i in range(5):
            rows.append({
                "Complaint ID": str(10000 + i),
                "Company": "TestBank",
                "Product": "Credit card",
                "Issue": "Billing",
                "Sub-issue": "",
                "State": "CA",
                "Date received": "2024-01-01",
                "Company response to consumer": "Closed",
                "Timely response?": "Yes",
                "Consumer disputed?": "No",
            })
        mock_download.return_value = _make_cfpb_zip(rows)
        result = enrich(["TestBank"], mock_config)
        assert len(result) == 2
        assert result[0]["company_name"] == "TestBank"
        assert result[1]["company_name"] == "TestBank"


class TestFdaRecallsEnrichment:
    @patch("enrichment.fda_recalls.safe_get")
    def test_returns_recalls(self, mock_safe_get, mock_config):
        from enrichment.fda_recalls import enrich
        mock_safe_get.return_value = {
            "results": [{
                "recall_number": "F-1234",
                "recalling_firm": "TestFood, Inc.",
                "product_description": "Tainted lettuce",
                "reason_for_recall": "Listeria contamination",
                "classification": "Class I",
                "status": "Ongoing",
                "recall_initiation_date": "20240115",
            }]
        }
        result = enrich(["TestFood"], mock_config)
        assert len(result) >= 1
        assert result[0]["agency"] == "FDA"
        assert result[0]["date"] == "2024-01-15"
        assert result[0]["firm_name"] == "TestFood, Inc."
        assert result[0]["match_confidence"] == "high"

    @patch("enrichment.fda_recalls.safe_get")
    def test_drops_recalls_from_a_different_firm(self, mock_safe_get, mock_config):
        # openFDA's phrase search returned Apple Valley Farms for "Apple".
        from enrichment.fda_recalls import enrich
        mock_safe_get.return_value = {"results": [{
            "recall_number": "F-9", "recalling_firm": "Apple Valley Farms LLC",
            "product_description": "Eggs", "recall_initiation_date": "20240115",
        }]}
        assert enrich(["Apple"], mock_config) == []


class TestCpscRecallsEnrichment:
    @patch("enrichment.cpsc_recalls.safe_get")
    def test_returns_recalls(self, mock_safe_get, mock_config):
        from enrichment.cpsc_recalls import enrich
        mock_safe_get.return_value = {
            "Results": [{
                "RecallNumber": "24-001",
                "Title": "Widget recall",
                "Description": "Fire hazard",
                "RecallDate": "2024-01-01",
                "Status": "Active",
                "Manufacturers": [{"Name": "TestMfg Corp., of Dallas, Texas", "CompanyID": ""}],
            }]
        }
        result = enrich(["TestMfg"], mock_config)
        assert len(result) == 1
        assert result[0]["agency"] == "CPSC"
        assert result[0]["recall_id"] == "CPSC-24-001"
        assert result[0]["firm_role"] == "manufacturer"

    @patch("enrichment.cpsc_recalls.safe_get")
    @patch("enrichment.cpsc_recalls.time.sleep")
    def test_title_match_alone_is_not_attribution(self, _sleep, mock_safe_get, mock_config):
        # RecallTitle is a substring search: "Ice" matched an ice-pack recall
        # made by someone else, and retailers only sold the product.
        from enrichment.cpsc_recalls import enrich
        mock_safe_get.return_value = [{
            "RecallNumber": "24-002",
            "Title": "Ice Packs Recalled Due to Ingestion Hazard; Sold Exclusively at Ice",
            "Manufacturers": [{"Name": "Cool Co. Ltd., of China"}],
            "Retailers": [{"Name": "Ice"}],
        }]
        assert enrich(["Ice"], mock_config) == []


class TestAggregateScoresEnrichment:
    def test_returns_true(self, mock_config):
        from enrichment.aggregate_scores import enrich
        result = enrich(mock_config)
        assert result is True


# ── Pipeline Checkpointing Tests ───────────────────────────
# These tests verify the checkpointing/dependency/limit logic directly
# without importing run_etl (which requires Python 3.10+ due to logo_dev.py).

class TestCheckpointing:
    def test_write_and_read_checkpoint(self, tmp_path):
        """Test checkpoint write and read using direct file operations."""
        import time
        cp_file = str(tmp_path / "stage_18.json")
        cp = {
            "stage": 18,
            "completed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "records_written": 100,
            "companies_processed": 50,
            "duration_seconds": 10.5,
        }
        with open(cp_file, "w") as f:
            json.dump(cp, f)

        with open(cp_file, "r") as f:
            loaded = json.load(f)
        today_utc = time.strftime("%Y-%m-%d", time.gmtime())
        assert loaded["completed_at"].startswith(today_utc)
        assert loaded["stage"] == 18

    def test_missing_checkpoint_returns_false(self, tmp_path):
        cp_file = str(tmp_path / "stage_99.json")
        assert not os.path.exists(cp_file)


class TestDependencyCheck:
    def test_all_new_stages_depend_on_stage_1(self):
        for stage in [18, 19, 20, 21, 22, 23, 24, 25, 26, 27]:
            deps = STAGE_DEPENDENCIES.get(stage, [])
            assert 1 in deps, f"Stage {stage} should depend on stage 1"

    def test_stage_24_depends_on_gleif(self):
        deps = STAGE_DEPENDENCIES.get(24, [])
        assert 2 in deps, "Stage 24 (UK Companies House) should depend on stage 2 (GLEIF)"


class TestLimitNames:
    def test_stage_limits_are_reasonable(self):
        # Bulk stages have no limit
        assert STAGE_LIMITS[18] == 0
        assert STAGE_LIMITS[20] == 0  # CFPB — bulk CSV
        assert STAGE_LIMITS[23] == 0
        assert STAGE_LIMITS[27] == 0
        # API stages have limits
        assert 0 < STAGE_LIMITS[19] <= 1000
        assert 0 < STAGE_LIMITS[21] <= 1000

    def test_limit_logic(self):
        """Test the limit logic inline (same as _limit_names)."""
        names = [f"Company_{i}" for i in range(1000)]
        limit = STAGE_LIMITS.get(7, 0)  # FEC limit is 300
        result = names[:limit] if limit > 0 else names
        assert len(result) == 300

        limit = STAGE_LIMITS.get(18, 0)  # OSHA limit is 0
        result = names[:limit] if limit > 0 else names
        assert len(result) == 1000


class TestWikidataExtendedEnrichment:
    @patch("enrichment.wikidata_extended.WikidataClient")
    def test_returns_rows_by_lei_and_classes_by_qid(self, mock_client, mock_config):
        from enrichment import wikidata_extended
        mock_client.return_value.fetch_extended_properties.return_value = [
            {"lei": "L1", "wikidata_id": "Q1", "country": "United States"},
            {"lei": "L1", "wikidata_id": "Q1", "country": None, "industry": "Retail"},
            {"lei": None, "wikidata_id": "Q2", "country": "France"},
        ]
        mock_client.return_value.fetch_lei_company_types.return_value = {"Q1": {"Q4830453"}}
        rows, types = wikidata_extended.enrich(mock_config)
        assert [r["lei"] for r in rows] == ["L1"]
        assert rows[0]["industry"] == "Retail", "blanks are filled from later rows"
        assert types == {"Q1": {"Q4830453"}}
