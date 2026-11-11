"""Tests for company_resolver.py — the name->identity resolution that stops
enrichment writers from fanning an edge out to every same-name company (C2/H8)."""

from types import SimpleNamespace

from company_resolver import (
    CompanyResolver,
    normalize_company_name,
    partition_rows,
    write_quarantine,
)


def _resolver(rows):
    return CompanyResolver(rows)


def test_unique_exact_name_resolves_high():
    r = _resolver([{"name": "Acme Corp", "lei": "LEI_ACME", "wikidata_id": None}])
    ref, matched_by, conf = r.resolve("Acme Corp")
    assert ref.key_field == "lei" and ref.key == "LEI_ACME"
    assert matched_by == "company_name_unique" and conf == "high"


def test_same_name_distinct_identities_is_ambiguous():
    # Two Company nodes share a name but are distinct legal entities (e.g. the
    # US Tesla vs the Czech TESLA a.s.) — must NEVER guess.
    r = _resolver([
        {"name": "Tesla", "lei": "LEI_US_TESLA", "wikidata_id": None},
        {"name": "Tesla", "lei": "LEI_CZ_TESLA", "wikidata_id": None},
    ])
    assert r.resolve("Tesla") is None
    assert r.explain("Tesla") == "ambiguous_exact(2)"


def test_lei_preferred_over_qid():
    r = _resolver([{"name": "Dual", "lei": "LEI_D", "wikidata_id": "Q1"}])
    ref, _, _ = r.resolve("Dual")
    assert ref.key_field == "lei"


def test_qid_used_when_no_lei():
    r = _resolver([{"name": "OnlyQid", "lei": None, "wikidata_id": "Q42"}])
    ref, _, _ = r.resolve("OnlyQid")
    assert ref.key_field == "wikidata_id" and ref.key == "Q42"


def test_node_without_identifier_is_unkeyable():
    r = _resolver([{"name": "Ghost", "lei": None, "wikidata_id": None}])
    assert r.resolve("Ghost") is None
    assert r.explain("Ghost") == "node_has_no_identifier"


def test_normalized_fallback_when_exact_misses():
    r = _resolver([{"name": "Widgets, Inc.", "lei": "LEI_W", "wikidata_id": None}])
    # Suffix/punct differences resolve via the normalized index at medium confidence.
    ref, matched_by, conf = r.resolve("Widgets Inc")
    assert ref.key == "LEI_W"
    assert matched_by == "company_name_normalized" and conf == "medium"


def test_ambiguous_normalized_is_none():
    r = _resolver([
        {"name": "North Line, a.s.", "lei": "LEI_A", "wikidata_id": None},
        {"name": "North-Line AS", "lei": "LEI_B", "wikidata_id": None},
    ])
    assert r.resolve("Northline") is None


def test_resolvable_names_excludes_ambiguous():
    r = _resolver([
        {"name": "Solo", "lei": "LEI_S", "wikidata_id": None},
        {"name": "Twin", "lei": "LEI_T1", "wikidata_id": None},
        {"name": "Twin", "lei": "LEI_T2", "wikidata_id": None},
    ])
    names = r.resolvable_names()
    assert "Solo" in names and "Twin" not in names


def test_partition_rows_keys_resolved_and_quarantines_ambiguous():
    r = _resolver([
        {"name": "Acme Corp", "lei": "LEI_ACME", "wikidata_id": None},
        {"name": "Dup", "lei": "LEI_D1", "wikidata_id": None},
        {"name": "Dup", "lei": "LEI_D2", "wikidata_id": None},
    ])
    rows = [
        {"company_name": "Acme Corp", "amount": 1},
        {"company_name": "Dup", "amount": 2},           # ambiguous -> quarantine
        {"company_name": "Unknown Co", "amount": 3},    # unknown -> quarantine
    ]
    resolved, quarantined = partition_rows(rows, r, stage="test")
    assert len(resolved) == 1 and len(quarantined) == 2
    assert resolved[0]["company_key_field"] == "lei"
    assert resolved[0]["company_key"] == "LEI_ACME"
    assert resolved[0]["matched_by"] == "company_name_unique+lei"
    reasons = {q["_quarantine_reason"] for q in quarantined}
    assert reasons == {"ambiguous_exact(2)", "unknown_name"}


def test_partition_rows_preserves_module_matched_by():
    r = _resolver([{"name": "Verified Co", "lei": "LEI_V", "wikidata_id": None}])
    rows = [{"company_name": "Verified Co", "matched_by": "facility_name_verified"}]
    resolved, _ = partition_rows(rows, r, stage="test")
    # module-supplied matched_by is preserved and suffixed with the key field;
    # confidence is not upgraded.
    assert resolved[0]["matched_by"] == "facility_name_verified+lei"


def test_write_quarantine_noop_when_empty(tmp_path):
    cfg = SimpleNamespace(cache_dir=str(tmp_path))
    write_quarantine([], "test", cfg)  # must not raise or create files
    assert not (tmp_path / "quarantine").exists()


def test_write_quarantine_writes_jsonl(tmp_path):
    cfg = SimpleNamespace(cache_dir=str(tmp_path))
    write_quarantine([{"company_name": "X", "_quarantine_reason": "unknown_name"}], "epa", cfg)
    files = list((tmp_path / "quarantine").glob("epa-*.jsonl"))
    assert len(files) == 1 and files[0].read_text().strip()


def test_normalizer_strips_suffix_and_punct():
    assert normalize_company_name("Acme, Inc.") == normalize_company_name("Acme")
