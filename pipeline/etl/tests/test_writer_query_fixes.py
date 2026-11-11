"""Cypher shape checks for writer bugs found in the 2026-09 review."""
from unittest.mock import MagicMock

from neo4j_writer import Neo4jWriter


def _writer():
    writer = Neo4jWriter.__new__(Neo4jWriter)
    writer.config = MagicMock(neo4j_database="neo4j", batch_size=5000)
    writer.driver = MagicMock()
    session = writer.driver.session.return_value.__enter__.return_value
    return writer, session


def test_sells_limits_one_product_per_row_not_per_batch():
    writer, session = _writer()
    writer.create_product_brand_rels([
        {"barcode": "0001", "brand_name": "Acme", "source": "off"},
        {"barcode": "0002", "brand_name": "Acme", "source": "off"},
    ])
    query = session.run.call_args_list[0][0][0]
    # A bare `WITH p, row LIMIT 1` after UNWIND capped each batch at one edge.
    assert "WITH p, row LIMIT 1" not in query
    assert "CALL (row)" in query and "RETURN p LIMIT 1" in query


def test_aggregates_recompute_every_company():
    writer, session = _writer()
    writer.update_aggregate_scores()
    queries = [c[0][0] for c in session.run.call_args_list]
    by_prop = {prop: q for (prop, _), q in zip(Neo4jWriter._AGGREGATES, queries)}
    for prop, q in by_prop.items():
        # Starting from every company is what lets a count fall back to 0.
        assert q.lstrip().startswith("MATCH (c:Company)\n"), prop
        assert f"coalesce(c.{prop}, 0) <> v" in q
    # EPA penalties used to be added onto last night's total for companies with
    # no PENALIZED_FOR edge, so the total grew every run.
    assert "coalesce(c.total_penalties, 0) +" not in by_prop["total_penalties"]
    assert "disputed" in by_prop["total_penalties"]


def test_rewritten_edges_drop_only_the_dispute_they_now_pass():
    clause = Neo4jWriter._clear_superseded_dispute("r", "epa_no_violation")
    assert "r.disputed_reason = 'epa_no_violation'" in clause
    assert "REMOVE r.disputed," in clause
    # Audit disputes (e.g. name_mismatch_contested) are untouched.
    assert "name_mismatch" not in clause
