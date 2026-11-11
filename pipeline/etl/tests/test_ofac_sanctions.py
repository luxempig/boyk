"""OFAC screening: a sanctions badge needs the name AND the country to agree.

Every case below is a real pair seen when screening the graph against the
2026-09 SDN list.
"""
import pytest

from enrichment.ofac_sanctions import load_entities, name_key, screen

SDN = [
    ["100", "LUKOIL OAO", "-0- ", "UKRAINE-EO13662] [RUSSIA-EO14024", "-0- "],
    ["200", "ARGOS", "-0- ", "RUSSIA-EO14024", "-0- "],
    ["300", "IVAN IVANOV", "individual", "RUSSIA-EO14024", "-0- "],
]
ALT = [["100", "1", "aka", "LUKOIL OIL COMPANY", "-0- "]]
ADD = [["100", "1", "Sretenskiy bulvar 11", "Moscow", "Russia", "-0- "],
       ["200", "1", "-0- ", "-0- ", "Russia", "-0- "]]


def _fetch(path):
    if "cons_" in path:
        return [] if "add" in path or "alt" in path else []
    return {"sdn.csv": SDN, "alt.csv": ALT, "add.csv": ADD}[path]


@pytest.fixture
def entities():
    return load_entities(fetch=_fetch)


def test_loads_entities_with_aliases_and_countries(entities):
    assert set(entities) == {"SDN:100", "SDN:200"}  # the individual is skipped
    assert entities["SDN:100"]["names"] == {"LUKOIL OAO", "LUKOIL OIL COMPANY"}
    assert entities["SDN:100"]["programs"] == ["RUSSIA-EO14024", "UKRAINE-EO13662"]
    assert entities["SDN:100"]["countries"] == {"russia"}


def test_flags_a_company_whose_name_and_country_match(entities):
    rows = screen([{"key_field": "lei", "key": "L1", "name": "Lukoil",
                    "country": "RU", "hq_country": "Russia"}], entities)
    assert rows[0]["key"] == "L1"
    assert rows[0]["sanction_lists"] == ["SDN"]
    assert rows[0]["sanction_entry"] == "LUKOIL OAO"


def test_same_name_in_another_country_is_not_flagged(entities):
    # Argos the UK retailer is not the sanctioned Russian Argos.
    assert screen([{"key_field": "lei", "key": "L2", "name": "Argos",
                    "country": "GB", "hq_country": "United Kingdom"}], entities) == []


def test_country_is_read_from_the_iso_code_when_hq_country_is_missing(entities):
    # ISO-2 -> name is learned from companies that carry both fields.
    companies = [
        {"key_field": "lei", "key": "L3", "name": "Lukoil", "country": "RU", "hq_country": None},
        {"key_field": "lei", "key": "L4", "name": "Other", "country": "RU", "hq_country": "Russia"},
    ]
    assert [r["key"] for r in screen(companies, entities)] == ["L3"]


def test_company_without_a_country_is_not_flagged(entities):
    assert screen([{"key_field": "wikidata_id", "key": "Q1", "name": "Lukoil",
                    "country": None, "hq_country": None}], entities) == []


@pytest.mark.parametrize("a,b", [
    ("LUKOIL OAO", "Lukoil"),
    ("Home Credit & Finance Bank Limited Liability Company", "Home Credit and Finance Bank"),
    ("PETROLEOS DE VENEZUELA, S.A.", "Petroleos de Venezuela"),
])
def test_name_key_ignores_punctuation_and_legal_forms(a, b):
    assert name_key(a) == name_key(b)
