"""Tests for neo4j_writer.py — Cypher query correctness and batch logic."""

from unittest.mock import MagicMock, patch, call
import pytest

from config import Config
from neo4j_writer import Neo4jWriter
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
    return config


@pytest.fixture
def writer(mock_config):
    with patch("neo4j_writer.GraphDatabase") as mock_gdb:
        mock_driver = MagicMock()
        mock_gdb.driver.return_value = mock_driver
        w = Neo4jWriter(mock_config)
        yield w


class TestRunBatch:
    def test_empty_batch_is_noop(self, writer):
        writer._run_batch("UNWIND $rows AS row RETURN row", [], "test")
        writer.driver.session.assert_not_called()

    def test_batch_uses_transaction(self, writer):
        mock_session = MagicMock()
        writer.driver.session.return_value.__enter__ = MagicMock(return_value=mock_session)
        writer.driver.session.return_value.__exit__ = MagicMock(return_value=False)

        writer._run_batch("UNWIND $rows AS row RETURN row", [{"a": 1}], "test")

        mock_session.execute_write.assert_called_once()

    def test_batch_rolls_back_on_error(self, writer):
        mock_session = MagicMock()
        mock_session.execute_write.side_effect = Exception("Write failed")
        writer.driver.session.return_value.__enter__ = MagicMock(return_value=mock_session)
        writer.driver.session.return_value.__exit__ = MagicMock(return_value=False)

        with pytest.raises(Exception, match="Write failed"):
            writer._run_batch("UNWIND $rows AS row RETURN row", [{"a": 1}], "test")


class TestRunChunked:
    def test_empty_data_is_noop(self, writer):
        writer._run_batch = MagicMock()
        writer._run_chunked("query", [], "test")
        writer._run_batch.assert_not_called()

    def test_splits_into_chunks(self, writer):
        writer.config.batch_size = 2
        writer._run_batch = MagicMock()

        data = [{"id": i} for i in range(5)]
        writer._run_chunked("query", data, "test")

        assert writer._run_batch.call_count == 3  # 2 + 2 + 1


class TestRelationshipProvenanceHelpers:
    def test_prepare_relationship_rows_normalizes_provenance(self, writer):
        rows = writer._prepare_relationship_rows(
            [{"company_name": "Acme", "case_id": "VT-1"}],
            default_source="violation_tracker",
            record_id_fields=["case_id"],
            matched_by="company_name_exact",
            match_confidence="medium",
        )
        assert rows[0]["source"] == "violation_tracker"
        assert rows[0]["source_record_id"] == "VT-1"
        assert rows[0]["matched_by"] == "company_name_exact"
        assert rows[0]["match_confidence"] == "medium"
        assert "evidence_key" in rows[0]
        assert "evidence_json" in rows[0]


class TestMergeSubsidies:
    def test_query_uses_merge_not_create(self, writer):
        writer._run_identity_partitioned = MagicMock()
        writer.merge_subsidies([{"company_name": "Test", "program_name": "P", "year": 2024}], _test_resolver())

        query = writer._run_identity_partitioned.call_args[0][0]
        assert "MERGE" in query
        assert "CREATE" not in query
        # Company is bound by identity (MATCH token), never MERGE-by-name.
        assert "Company {name:" not in query
        assert writer.COMPANY_MATCH_TOKEN in query

    def test_merge_key_is_composite(self, writer):
        writer._run_identity_partitioned = MagicMock()
        writer.merge_subsidies([{"company_name": "Test", "program_name": "P", "year": 2024}], _test_resolver())

        query = writer._run_identity_partitioned.call_args[0][0]
        assert "company_name: row.company_name" in query
        assert "program_name: row.program_name" in query
        assert "year: row.year" in query

    def test_relationship_query_includes_provenance_fields(self, writer):
        writer._run_identity_partitioned = MagicMock()
        writer.merge_subsidies([{"company_name": "Test", "program_name": "P", "year": 2024}], _test_resolver())

        query = writer._run_identity_partitioned.call_args[0][0]
        rows = writer._run_identity_partitioned.call_args[0][1]
        assert "evidence_record_ids" in query
        assert "evidence_keys" in query
        assert "matched_by" in query
        assert "provenance_version" in query
        assert rows[0]["source_record_id"] == "Test|P|2024"
        assert rows[0]["source"] == "subsidy_tracker"
        # Resolved to an identity partition.
        assert rows[0]["company_key_field"] == "lei"
        assert rows[0]["company_key"] == "L_TEST"


class TestMergeCompanies:
    def test_lei_merge_appends_data_sources(self, writer):
        writer._run_chunked = MagicMock()
        writer.merge_companies([{"lei": "L1", "name": "Test", "data_sources": ["wikidata"]}], merge_field="lei")

        query = writer._run_chunked.call_args[0][0]
        assert "REDUCE" in query
        assert "CASE WHEN src IN acc" in query

    def test_wikidata_merge_appends_data_sources(self, writer):
        writer._run_chunked = MagicMock()
        writer.merge_companies([{"wikidata_id": "Q1", "name": "Test", "data_sources": ["gleif"]}], merge_field="wikidata_id")

        query = writer._run_chunked.call_args[0][0]
        assert "REDUCE" in query

    def test_name_merge_is_rejected(self, writer):
        writer._run_chunked = MagicMock()
        with pytest.raises(ValueError, match="stable external identifier"):
            writer.merge_companies([{"name": "Test", "data_sources": ["fec"]}], merge_field="name")
        writer._run_chunked.assert_not_called()

    def test_lei_merge_guards_wikidata_stamping(self, writer):
        writer._run_chunked = MagicMock()
        writer.merge_companies([{"lei": "L1", "name": "Test", "wikidata_id": "Q1"}], merge_field="lei")

        query = writer._run_chunked.call_args[0][0]
        # The QID may only be stamped when no other node owns it.
        assert "EXISTS { MATCH (o:Company {wikidata_id: row.wikidata_id})" in query


class TestSchemaSetup:
    def test_creates_all_indexes(self, writer):
        mock_session = MagicMock()
        writer.driver.session.return_value.__enter__ = MagicMock(return_value=mock_session)
        writer.driver.session.return_value.__exit__ = MagicMock(return_value=False)

        writer.setup_constraints_and_indexes()

        run_calls = mock_session.run.call_args_list
        statements = [c[0][0] for c in run_calls]

        # Check critical indexes exist
        assert any("product_asin" in s for s in statements), "Missing product_asin index"
        assert any("product_name" in s for s in statements), "Missing product_name index"
        assert any("subsidy_year" in s for s in statements), "Missing subsidy_year index"
        assert any("violation_year" in s for s in statements), "Missing violation_year index"
        assert any("politician_name" in s for s in statements), "Missing politician_name index"
        assert any("product_upc" in s for s in statements), "Missing product_upc index"

        # Check constraints
        assert any("company_lei" in s for s in statements), "Missing company_lei constraint"
        assert any("facility_osid" in s for s in statements), "Missing facility_osid constraint"


class TestMergeProducts:
    def test_merge_by_barcode(self, writer):
        writer._run_chunked = MagicMock()
        writer.merge_products([{"barcode": "123", "name": "Test"}])

        query = writer._run_chunked.call_args[0][0]
        assert "barcode: row.barcode" in query

    def test_merge_by_asin(self, writer):
        writer._run_chunked = MagicMock()
        writer.merge_products_by_asin([{"asin": "B001", "name": "Test"}])

        query = writer._run_chunked.call_args[0][0]
        assert "asin: row.asin" in query


class TestDonationRels:
    def test_fec_uses_donated_to(self, writer):
        mock_session = MagicMock()
        writer.driver.session.return_value.__enter__ = MagicMock(return_value=mock_session)
        writer.driver.session.return_value.__exit__ = MagicMock(return_value=False)

        writer.create_donation_rels([{
            "company_name": "Test", "fec_id": "F1",
            "politician_name": "John", "party": "D",
            "state": "CA", "office": "Senate",
            "amount": 1000, "year": "2024",
        }], _test_resolver(), source="fec")

        query = mock_session.run.call_args[0][0]
        assert "DONATED_TO" in query
        assert "Company {name:" not in query

    def test_state_uses_donated_to_state(self, writer):
        mock_session = MagicMock()
        writer.driver.session.return_value.__enter__ = MagicMock(return_value=mock_session)
        writer.driver.session.return_value.__exit__ = MagicMock(return_value=False)

        writer.create_donation_rels([{
            "company_name": "Test", "fec_id": "F1",
            "politician_name": "John", "party": "D",
            "state": "CA", "office": "Senate",
            "amount": 1000, "year": "2024",
        }], _test_resolver(), source="followthemoney")

        query = mock_session.run.call_args[0][0]
        assert "DONATED_TO_STATE" in query
        assert "evidence_record_ids" in query
        assert "evidence_keys" in query


class TestRelationshipProvenanceAudit:
    def test_backfill_relationship_provenance_returns_counts(self, writer):
        mock_session = MagicMock()
        mock_result = MagicMock()
        mock_result.single.return_value = {"total_rels": 12, "flagged_missing_source": 3}
        mock_session.run.return_value = mock_result
        writer.driver.session.return_value.__enter__ = MagicMock(return_value=mock_session)
        writer.driver.session.return_value.__exit__ = MagicMock(return_value=False)

        result = writer.backfill_relationship_provenance()

        assert result["total_rels"] == 12
        assert result["flagged_missing_source"] == 3
        query = mock_session.run.call_args[0][0]
        assert "legacy_unknown" in query
        assert "provenance_needs_review" in query

    def test_audit_relationship_provenance_detects_missing_fields(self, writer):
        mock_session = MagicMock()
        mock_session.run.side_effect = [
            [
                {
                    "rel_type": "SUPPLIES",
                    "total": 10,
                    "missing_source": 1,
                    "missing_last_confirmed": 2,
                    "missing_evidence": 3,
                }
            ],
            [
                {
                    "rel_type": "SUPPLIES",
                    "from_labels": ["Company"],
                    "to_labels": ["Company"],
                    "rel_properties": {"confidence": "high"},
                }
            ],
            MagicMock(single=MagicMock(return_value={"n": 7})),
        ]
        writer.driver.session.return_value.__enter__ = MagicMock(return_value=mock_session)
        writer.driver.session.return_value.__exit__ = MagicMock(return_value=False)

        result = writer.audit_relationship_provenance(sample_limit=5)
        # Disputed (hidden) edges are counted but not held to provenance.
        assert result["totals"]["disputed_excluded"] == 7
        summary_query, sample_query = (c[0][0] for c in mock_session.run.call_args_list[:2])
        assert "NOT coalesce(r.disputed, false)" in summary_query
        assert "NOT coalesce(r.disputed, false)" in sample_query

        assert result["ok"] is False
        assert result["totals"]["missing_source"] == 1
        assert result["totals"]["missing_last_confirmed"] == 2
        assert result["totals"]["missing_evidence"] == 3
        assert len(result["samples"]) == 1


class TestLeiQidDisagreements:
    def test_compares_each_lei_against_all_of_its_wikidata_items(self, writer):
        # Delta's LEI is on two Wikidata items; either is a valid QID. Only a
        # QID that is none of them (Lenovo's on the Huawei LEI node) is wrong.
        session = MagicMock()
        session.execute_read.side_effect = lambda fn: fn(tx)
        tx = MagicMock()
        tx.run.return_value = [{"lei": "HUAWEI", "name": "Huawei", "graph_qid": "Q14799",
                                "wikidata_qids": ["Q160120"]}]
        writer.driver.session.return_value.__enter__ = MagicMock(return_value=session)
        writer.driver.session.return_value.__exit__ = MagicMock(return_value=False)

        found = writer.find_lei_qid_disagreements([
            {"lei": "DELTA", "wikidata_id": "Q188920"},
            {"lei": "DELTA", "wikidata_id": "Q2664062"},
            {"lei": "HUAWEI", "wikidata_id": "Q160120"},
            {"lei": "NOQID", "wikidata_id": None},
        ])
        query, kwargs = tx.run.call_args[0][0], tx.run.call_args[1]
        assert "NOT c.wikidata_id IN row.qids" in query
        assert sorted(kwargs["rows"], key=lambda r: r["lei"]) == [
            {"lei": "DELTA", "qids": ["Q188920", "Q2664062"]},
            {"lei": "HUAWEI", "qids": ["Q160120"]},
        ]
        assert found == [{"lei": "HUAWEI", "name": "Huawei", "graph_qid": "Q14799", "wikidata_qids": ["Q160120"]}]


class TestPacDonationEdges:
    def test_pac_edges_are_federal_and_separate_from_employee_edges(self, writer):
        # Merging on the company-candidate pair alone would reuse the disputed
        # employee-donation edge and keep the PAC gift hidden.
        resolver = MagicMock()
        resolver.resolve.return_value = (MagicMock(key_field="lei", key="L1"), "company_name_unique", "high")
        session = MagicMock()
        writer.driver.session.return_value.__enter__ = MagicMock(return_value=session)
        writer.driver.session.return_value.__exit__ = MagicMock(return_value=False)
        with patch("neo4j_writer.write_quarantine"):
            writer.create_donation_rels([{"company_name": "ACME CORP", "fec_id": "S1", "politician_name": "X",
                                          "party": "DEM", "state": "TX", "office": "Senate",
                                          "amount": 10.0, "year": 2026}], resolver, source="fec_pac")
        queries = [c[0][0] for c in session.run.call_args_list] + \
                  [c[0][0] for c in getattr(session.execute_write, "call_args_list", [])
                   if c[0] and isinstance(c[0][0], str)]
        q = next(x for x in queries if "MERGE (c)-" in x)
        assert "DONATED_TO {source: $source}" in q and "DONATED_TO_STATE" not in q
