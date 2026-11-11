"""
Stage 25: OFAC sanctions (SDN and Consolidated lists)

Replaces OpenSanctions, whose data is CC BY-NC and needs a paid license for a
commercial app. OFAC's lists are US government works in the public domain.

Every company in the graph is screened against both lists in one pass. A
sanctions badge is an accusation, so a company is flagged only when:
  - an OFAC entity (not a person, vessel or aircraft) carries the same name,
    once legal forms are set aside (firm_match's "firm_name_verified"), and
  - one of that entity's OFAC addresses is in the company's country.
Name-only hits are logged, never written: "Argos" the UK retailer shares a name
with a sanctioned Russian Argos, and Crown Resorts (Australia) with a Cambodian
Crown Resorts.
"""

import csv
import io
import logging
from collections import defaultdict
from typing import Dict, List, Optional

import requests

from enrichment.firm_match import _core, _tokens

logger = logging.getLogger(__name__)

BASE_URL = "https://www.treasury.gov/ofac/downloads"
# (list name, primary names, aliases, addresses)
LISTS = [
    ("SDN", "sdn.csv", "alt.csv", "add.csv"),
    ("Consolidated", "consolidated/cons_prim.csv", "consolidated/cons_alt.csv", "consolidated/cons_add.csv"),
]
ENTITY_TYPE = "-0-"  # OFAC leaves SDN_Type empty ("-0-") for entities


def _download(path: str) -> Optional[List[List[str]]]:
    """Fetch one OFAC CSV (the URL redirects to a signed S3 object)."""
    resp = requests.get(f"{BASE_URL}/{path}", timeout=120,
                        headers={"User-Agent": "BoykETL/2.0 (contact@boyk.app)"})
    if resp.status_code == 404:
        return None
    resp.raise_for_status()
    return list(csv.reader(io.StringIO(resp.content.decode("latin-1"))))


def _clean(value: str) -> str:
    value = (value or "").strip()
    return "" if value == "-0-" else value


def name_key(name: str) -> str:
    """The comparison key two names must share: tokens minus legal forms.

    "and" is dropped too, so "Home Credit & Finance Bank" and "Home Credit and
    Finance Bank" are one key.
    """
    return " ".join(t for t in _core(_tokens(name)) if t != "and")


def load_entities(fetch=_download) -> Dict[str, Dict]:
    """OFAC entities keyed "<list>:<ent_num>", with names, programs and countries."""
    entities: Dict[str, Dict] = {}
    for list_name, prim, alt, add in LISTS:
        rows = fetch(prim)
        if rows is None:
            raise RuntimeError(f"OFAC {list_name} list not found at {BASE_URL}/{prim}")
        for r in rows:
            if len(r) < 4 or r[2].strip() != ENTITY_TYPE:
                continue
            entities[f"{list_name}:{r[0].strip()}"] = {
                "list": list_name,
                "name": _clean(r[1]),
                "names": {_clean(r[1])},
                "programs": sorted({p.strip() for p in _clean(r[3]).replace("] [", "|").strip("[]").split("|") if p.strip()}),
                "countries": set(),
            }
        for r in fetch(alt) or []:  # the Consolidated list publishes no alias file today
            e = entities.get(f"{list_name}:{r[0].strip()}") if r else None
            if e and len(r) > 3 and _clean(r[3]):
                e["names"].add(_clean(r[3]))
        for r in fetch(add) or []:
            e = entities.get(f"{list_name}:{r[0].strip()}") if r else None
            if e and len(r) > 4 and _clean(r[4]):
                e["countries"].add(_clean(r[4]).lower())
    return entities


def country_names(companies: List[Dict]) -> Dict[str, str]:
    """ISO 3166 alpha-2 -> English country name, learned from the graph itself.

    GLEIF gives `country` as an ISO code and Wikidata gives `hq_country` as an
    English name; OFAC addresses use English names. Tens of thousands of
    companies carry both, which is enough to map every code that matters.
    """
    votes: Dict[str, Dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for c in companies:
        if c.get("country") and c.get("hq_country"):
            votes[c["country"]][c["hq_country"].lower()] += 1
    return {code: max(names, key=names.get) for code, names in votes.items()}


def screen(companies: List[Dict], entities: Dict[str, Dict]) -> List[Dict]:
    """Return sanction rows for companies that pass both the name and country tests.

    companies: dicts with key_field, key, name, country (ISO-2), hq_country.
    """
    by_name: Dict[str, List[str]] = defaultdict(list)
    for ent_id, e in entities.items():
        for n in e["names"]:
            k = name_key(n)
            if k:
                by_name[k].append(ent_id)

    codes = country_names(companies)
    rows, name_only = [], 0
    for c in companies:
        hits = by_name.get(name_key(c.get("name") or ""), [])
        if not hits:
            continue
        where = {x for x in ((c.get("hq_country") or "").lower(), codes.get(c.get("country") or "", "")) if x}
        matched = [entities[h] for h in hits if where & entities[h]["countries"]]
        if not matched:
            name_only += 1
            logger.info(f"OFAC: name-only hit not written: {c.get('name')!r} ({c.get('country')}) "
                        f"~ {entities[hits[0]]['name']!r} {sorted(entities[hits[0]]['countries'])[:3]}")
            continue
        rows.append({
            "key_field": c["key_field"],
            "key": c["key"],
            "sanction_lists": sorted({e["list"] for e in matched}),
            "sanction_programs": sorted({p for e in matched for p in e["programs"]}),
            "sanction_entry": matched[0]["name"],
        })
    logger.info(f"Stage 25: {len(rows)} companies on OFAC lists; {name_only} name-only hits not written")
    return rows


def enrich(companies: List[Dict]) -> List[Dict]:
    """Download both OFAC lists and screen every company."""
    entities = load_entities()
    logger.info(f"Stage 25: loaded {len(entities)} OFAC entities")
    return screen(companies, entities)
