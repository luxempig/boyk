"""
Wikidata SPARQL Client
Handles Stage 1 (base entities), Stage 4 (product IDs), Stage 14 (extended properties).
"""

import json
import logging
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional

import requests

from config import Config
from models import Company, Brand, Person, Relationship, now_iso

logger = logging.getLogger(__name__)

# Label fallback order. "mul" is Wikidata's language-neutral label: editors
# remove redundant "en" labels in its favor (Walmart has only "mul" and
# "ja"), so without it the fallback lands on whatever language comes next.
LABEL_LANGUAGES = "en,mul,de,fr,es,pt,it,nl,ja,zh,ko,ru,pl,sv,ar"

# Classes that mark an item as a public body or institution rather than a
# company, checked directly against P31 with no subclass closure.
#
# Wikidata's own business closure is unreliable in both directions, so the
# absence of a business class proves nothing: Hasbro, Décathlon, Holcim and
# Société Générale are typed only "organization" (Q43229), while "record
# label" and "credit institution" fall outside the closure. Only an explicit
# class from this list excludes an item; every QID here was checked by label.
PUBLIC_SECTOR_CLASSES = {
    # education
    "Q9842",        # primary school
    "Q126807",      # kindergarten
    "Q159334",      # secondary school
    "Q3918",        # university
    "Q875538",      # public university
    "Q902104",      # private university
    "Q3914",        # school
    "Q2385804",     # educational institution
    "Q23002054",    # private not-for-profit educational institution
    "Q23002039",    # public educational institution of the United States
    "Q10861807",    # primary art school
    "Q55043",       # gymnasium
    "Q4671277",     # academic institution
    "Q180958",      # faculty
    "Q2467461",     # academic department
    "Q398141",      # school district
    "Q9311671",     # residential child care community
    "Q189004",      # college
    # research, laboratories, libraries
    "Q31855",       # research institute
    "Q483242",      # laboratory
    "Q3550864",     # French UMR
    "Q7315155",     # research center
    "Q1622062",     # university library
    "Q28564",       # public library
    "Q856234",      # academic library
    "Q11396180",    # library branch
    "Q7075",        # library
    # government and administrative bodies
    "Q327333",      # government agency
    "Q7188",        # government
    "Q3917681",     # embassy
    "Q2132839",     # Council Working Party
    "Q18744396",    # state-level organisation
    "Q856076",      # municipality of Finland
    "Q493522",      # municipality of Belgium
    "Q1549591",     # big city
    "Q62049",       # county seat
    "Q486972",      # human settlement
    "Q515",         # city
    "Q15284",       # municipality
    "Q262166",      # municipality in Germany
    "Q3266850",     # commune
    "Q176799",      # military unit
    "Q2659904",     # government organization
    "Q192350",      # ministry
    "Q35798",       # executive branch
    "Q37726",       # army
    "Q20857065",    # United States federal agency
    "Q1752939",     # independent agency of the United States government
    "Q17505024",    # space agency
    "Q4936585",     # body of the European Union
    "Q748720",      # institutions of the European Union
    "Q97374157",    # international parliament
    "Q784271",      # diplomatic service
    "Q13582798",    # French public establishment of a scientific and technological character
    "Q414147",      # academy of sciences
    "Q1248049",     # Land (German federal state)
    # Czech administrative units: the graph is ~32% Czech companies, so these
    # classes turn up constantly (Prague alone parented 142 "subsidiaries").
    "Q5153359",     # municipality of the Czech Republic
    "Q7819319",     # Czech municipality with expanded powers
    "Q7841907",     # municipality with authorized municipal office
    "Q15978299",    # municipality with town privileges in the Czech Republic
    "Q76009696",    # administrative district of Czech municipality with authorized municipal office
    "Q76007695",    # administrative district of Czech municipality with expanded powers
    "Q548611",      # district of the Czech Republic
    "Q38911",       # region of the Czech Republic
    "Q12031379",    # capital of region
    "Q108178728",   # national capital
    "Q8452914",     # district town
    # health, culture, religion, sport, historical
    "Q16917",       # hospital
    "Q33506",       # museum
    "Q102496",      # parish
    "Q476028",      # association football club
    "Q1478443",     # association football federation
    "Q152081",      # concentration camp
    "Q7278",        # political party
}

# Corporate forms that override a public-sector class, so a state-owned
# enterprise or a university-owned trading company stays a company.
#
# This is a short explicit list, NOT the P279* closure under "business": that
# closure transitively contains "municipality of the Czech Republic" and
# "open-access publisher", which cancelled the classification of Prague and
# the CNRS when it was used here.
BUSINESS_OVERRIDE_CLASSES = {
    "Q4830453",     # business
    "Q783794",      # company
    "Q6881511",     # enterprise
    "Q891723",      # public company
    "Q167037",      # corporation
    "Q1589009",     # privately held company
    "Q219577",      # holding company
    "Q161726",      # multinational corporation
    "Q270791",      # state-owned enterprise
}


def _sanitize(text: str) -> str:
    """Remove JSON-breaking control characters from SPARQL results."""
    if not text:
        return text
    return re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", text)


def _clean_name(name: str) -> str:
    """Strip leading/trailing quotes from Wikidata labels (e.g. '"APR"' -> 'APR')."""
    if not name:
        return name
    return name.strip().strip('"').strip("'").strip()


def _is_qid(name: str) -> bool:
    """Check if a name is just a Wikidata QID (e.g. 'Q2185472')."""
    if not name:
        return False
    return bool(re.match(r'^Q\d+$', name.strip()))


def _name_from_website(url: str) -> str:
    """Extract a human-readable brand name from a website URL.
    e.g. 'https://www.coca-cola.com' -> 'Coca Cola'
    """
    if not url:
        return ""
    # Strip protocol and www
    domain = re.sub(r'^https?://(www\.)?', '', url).split('/')[0]
    # Take the main domain part (before TLD)
    parts = domain.split('.')
    if len(parts) >= 2:
        name_part = parts[-2]  # e.g. 'coca-cola' from 'www.coca-cola.com'
    else:
        name_part = parts[0]
    # Convert hyphens/underscores to spaces and title-case
    name_part = re.sub(r'[-_]', ' ', name_part)
    return name_part.title()


def _ownership_percentage(raw_value) -> Optional[float]:
    """Normalize a P1107 (proportion) value to a percentage.

    Wikidata holds either a fraction (0..1] or an already-percent value
    (1..100]; multiplying everything by 100 once produced values up to 10000 in
    prod. <=1.0 is treated as a fraction (1.0 means full ownership).
    """
    if raw_value is None:
        return None
    try:
        raw = float(raw_value)
    except (ValueError, TypeError):
        return None
    return raw * 100 if raw <= 1.0 else raw


class WikidataClient:
    def __init__(self, config: Config):
        self.config = config
        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": config.wikidata_user_agent,
            "Accept": "application/sparql-results+json",
        })

    def _query(self, sparql: str, retries: int = 3) -> List[Dict]:
        """Execute SPARQL query with retries and rate limiting."""
        for attempt in range(retries):
            try:
                # POST, not GET: WDQS caches GET responses, including the
                # truncated 200 it sends when a query hits its 60s limit, so a
                # GET retry replays the same broken body within seconds.
                resp = self.session.post(
                    self.config.wikidata_endpoint,
                    data={"query": sparql, "format": "json"},
                    timeout=120,
                )
                if resp.status_code == 429:
                    wait = int(resp.headers.get("Retry-After", 60))
                    logger.warning(f"Rate limited, waiting {wait}s")
                    time.sleep(wait)
                    continue
                resp.raise_for_status()
                text = _sanitize(resp.text)
                data = json.loads(text, strict=False)
                results = data.get("results", {}).get("bindings", [])

                # Warn if results may be truncated by LIMIT
                limit_match = re.search(r'LIMIT\s+(\d+)', sparql, re.IGNORECASE)
                if limit_match:
                    limit = int(limit_match.group(1))
                    if len(results) >= limit * 0.95:
                        logger.warning(
                            f"SPARQL query returned {len(results)}/{limit} results — "
                            f"may be truncated. Consider increasing LIMIT."
                        )

                return results
            except requests.exceptions.Timeout:
                logger.warning(f"SPARQL query timeout (attempt {attempt + 1}/{retries})")
                if attempt < retries - 1:
                    time.sleep(10 * (attempt + 1))
            except Exception as e:
                logger.warning(f"SPARQL query attempt {attempt + 1} failed: {e}")
                if attempt < retries - 1:
                    time.sleep(5 * (attempt + 1))
        # Exhausted retries. Raising (instead of returning []) is deliberate: a
        # silent [] is indistinguishable from a genuinely empty result, and it
        # propagates up as a truncated fresh-keys set that then drives stale-
        # ownership retraction to delete valid edges. Failing the stage means
        # the orchestrator skips its checkpoint and never runs retraction on
        # partial data. A truly empty query still returns [] via the normal
        # path above; only exhausted failure reaches here.
        raise RuntimeError(f"SPARQL query failed after {retries} attempts")

    def _val(self, row: dict, key: str) -> Optional[str]:
        """Extract value from SPARQL result binding."""
        binding = row.get(key)
        if binding:
            v = binding.get("value", "")
            if v.startswith("http://www.wikidata.org/entity/"):
                return v.split("/")[-1]
            return v
        return None

    # ── Stage 1: Base Entities ────────────────────────────────

    # Stage 1's large fetches leave names out of the main query and resolve
    # them with fetch_labels: the label service over ~50K rows is what pushed
    # these queries to WDQS's 60s limit (41s at 03:00 UTC, over 60s by day).

    def fetch_companies_with_lei(self) -> List[Dict]:
        """Fetch all companies that have an LEI (Legal Entity Identifier)."""
        results = self._query("""
        SELECT ?company ?lei ?website ?logo WHERE {
          ?company wdt:P1278 ?lei .
          OPTIONAL { ?company wdt:P856 ?website }
          OPTIONAL { ?company wdt:P154 ?logo }
        }
        """)
        labels = self.fetch_labels({self._val(r, "company") for r in results})
        companies = []
        for row in results:
            qid = self._val(row, "company")
            companies.append({
                "wikidata_id": qid,
                # The label service answered an unlabelled item with its QID.
                "name": labels.get(qid, qid or ""),
                "lei": self._val(row, "lei"),
                "website": self._val(row, "website"),
                "logo_url": self._val(row, "logo"),
            })
        logger.info(f"Stage 1: fetched {len(companies)} companies with LEI from Wikidata")
        return companies

    def fetch_brands(self) -> List[Dict]:
        """Fetch brands with their parent company, one row per (brand, owner).

        Brands are items whose class descends from brand (Q431289); owners
        (P127) count unless they are a public body (see
        PUBLIC_SECTOR_CLASSES). The old single query
        also stopped at LIMIT 50000 rows without an order, so which brands
        survived varied from night to night.
        """
        brand_classes = sorted(
            self._val(r, "cls") for r in self._query(
                "SELECT DISTINCT ?cls WHERE { ?cls wdt:P279* wd:Q431289 }")
        )
        classes = " ".join(f"wd:{c}" for c in brand_classes)
        rows = self._query(f"""
        SELECT ?brand ?website ?logo WHERE {{
          VALUES ?cls {{ {classes} }}
          ?brand wdt:P31 ?cls .
          OPTIONAL {{ ?brand wdt:P856 ?website }}
          OPTIONAL {{ ?brand wdt:P154 ?logo }}
        }}
        """)
        owner_types: Dict[str, set] = {}
        brand_owners: Dict[str, set] = {}
        for row in self._query(f"""
        SELECT ?brand ?owner ?ownerType WHERE {{
          VALUES ?cls {{ {classes} }}
          ?brand wdt:P31 ?cls ; wdt:P127 ?owner .
          ?owner wdt:P31 ?ownerType .
        }}
        """):
            owner = self._val(row, "owner")
            owner_types.setdefault(owner, set()).add(self._val(row, "ownerType"))
            brand_owners.setdefault(self._val(row, "brand"), set()).add(owner)
        public_owners = {o for o, classes in owner_types.items() if self.is_public_sector(classes)}
        try:
            controlling = self._controlling_brand_owners(classes)
        except RuntimeError as e:
            # Unfiltered P127 would write index funds back as owners, so a run
            # that cannot tell owners from shareholders writes no owners at all
            # (brand ownership edges are kept, not retracted, when absent).
            logger.warning(f"Stage 1: brand owner qualifiers unavailable, skipping owners ({e})")
            controlling = set()
            self.rejected_brand_owners = set()
        owners = {brand: {o for o in os - public_owners if o != brand and (brand, o) in controlling}
                  for brand, os in brand_owners.items()}

        details: Dict[str, Dict] = {}
        for row in rows:
            d = details.setdefault(self._val(row, "brand"), {})
            for key in ("website", "logo"):
                if key not in d and self._val(row, key):
                    d[key] = self._val(row, key)
        labels = self.fetch_labels(details.keys())

        brands = []
        qid_count = 0
        qid_fixed = 0
        for qid in sorted(details):
            d = details[qid]
            name = labels.get(qid, qid)
            website = d.get("website")
            if _is_qid(name):
                qid_count += 1
                # Try to derive name from website domain
                derived = _name_from_website(website)
                if derived:
                    name = derived
                    qid_fixed += 1
            for owner in sorted(owners.get(qid, ())) or [None]:
                brands.append({
                    "wikidata_id": qid,
                    "name": name,
                    "owner_wikidata_id": owner,
                    "website": website,
                    "logo_url": d.get("logo"),
                })

        if qid_count:
            logger.info(
                f"Stage 1: {qid_count} brands had QID-only names, "
                f"fixed {qid_fixed} from website domains, "
                f"{qid_count - qid_fixed} remain as QIDs"
            )
        logger.info(f"Stage 1: fetched {len(details)} brands ({len(brands)} brand-owner rows) from Wikidata")
        return brands

    CONTROLLING_SHARE = 50.0

    def _owner_verdicts(self, rows) -> tuple:
        """Split P127 statement rows into (controlling pairs, rejected pairs).

        P127 ("owned by") holds shareholdings as well as owners: Walmart lists
        Vanguard at 4.5% and BlackRock at 3%, so without this those index funds
        showed up as the owners of Walmart, McDonald's and Shell. It also keeps
        past owners, marked only by an end time: Duracell <- Procter & Gamble
        ended in 2014. A pair is controlling if any of its statements has no end
        time in the past and no proportion under half (a brand sold and later
        bought back has one current statement). It is rejected - Wikidata itself
        says it is not the owner now - if it has statements and none qualifies,
        or if the brand "owns" itself.
        """
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        statements: Dict[str, Dict] = {}
        for row in rows:
            st = statements.setdefault(self._val(row, "st"), {
                "pair": (self._val(row, "brand"), self._val(row, "owner")), "pct": [], "end": []})
            if self._val(row, "pct"):
                st["pct"].append(self._val(row, "pct"))
            if self._val(row, "end"):
                st["end"].append(self._val(row, "end"))
        controlling = set()
        for st in statements.values():
            ended = any(e[:10] <= today for e in st["end"])
            shares = [_ownership_percentage(v) for v in st["pct"]]
            minority = any(v is not None and v < self.CONTROLLING_SHARE for v in shares)
            if not ended and not minority:
                controlling.add(st["pair"])
        pairs = {st["pair"] for st in statements.values()}
        rejected = (pairs - controlling) | {(b, o) for b, o in pairs if b == o}
        return controlling, rejected

    def _controlling_brand_owners(self, classes: str) -> set:
        """(brand, owner) pairs where the owner currently controls the brand."""
        controlling, self.rejected_brand_owners = self._owner_verdicts(self._query(f"""
        SELECT ?brand ?owner ?st ?pct ?end WHERE {{
          VALUES ?cls {{ {classes} }}
          ?brand wdt:P31 ?cls ; wdt:P127 ?owner ; p:P127 ?st .
          ?st ps:P127 ?owner .
          OPTIONAL {{ ?st pq:P1107 ?pct }}
          OPTIONAL {{ ?st pq:P582 ?end }}
        }}
        """))
        logger.info(f"Stage 1: {len(controlling)} brand-owner pairs are current, controlling owners; "
                    f"{len(self.rejected_brand_owners)} ended, minority or self")
        return controlling

    def rejected_owner_pairs(self, pairs: set, batch: int = 100) -> set:
        """Which of these (brand, owner) pairs Wikidata marks as not owning now.

        Asked per brand QID rather than per brand class, so an edge written
        while the item was typed as a brand (Shell plc, now a company) is still
        checked. A pair with no P127 statement at all is not rejected: absence
        may be re-modelling, not evidence the ownership ended.
        """
        brands = sorted({b for b, _ in pairs})
        rejected = set()
        failed = 0
        for i in range(0, len(brands), batch):
            values = " ".join(f"wd:{b}" for b in brands[i:i + batch])
            try:
                rows = self._query(f"""
            SELECT ?brand ?owner ?st ?pct ?end WHERE {{
              VALUES ?brand {{ {values} }}
              ?brand p:P127 ?st . ?st ps:P127 ?owner ; wikibase:rank ?rank .
              FILTER(?rank != wikibase:DeprecatedRank)
              OPTIONAL {{ ?st pq:P1107 ?pct }}
              OPTIONAL {{ ?st pq:P582 ?end }}
            }}
            """)
            except RuntimeError as e:
                # Only positive evidence retracts, so a batch WDQS would not
                # answer just means those brands are checked on a later night.
                failed += 1
                logger.warning(f"Brand owner check: batch {i // batch} skipped ({e})")
                continue
            rejected |= self._owner_verdicts(rows)[1] & pairs
        rejected |= {(b, o) for b, o in pairs if b == o}
        if failed:
            logger.warning(f"Brand owner check: {failed} of {-(-len(brands) // batch)} batches skipped")
        return rejected

    @staticmethod
    def is_public_sector(classes: set) -> bool:
        """True for a school, city, library or similar — not a company.

        A corporate form wins, so a state-owned enterprise stays a company.
        """
        return bool(classes & PUBLIC_SECTOR_CLASSES) and not (classes & BUSINESS_OVERRIDE_CLASSES)

    def fetch_subsidiaries(self) -> List[Dict]:
        """Fetch business-to-business parent-subsidiary (P749) pairs with references.

        The type check used to be a `wdt:P31/wdt:P279*` path on both ends of
        every P749 statement inside one query. WDQS evaluates that per row, so
        the query ran past its 60s limit even at 2,500 rows and stage 1 failed
        every night on a truncated response. It is now four plain queries,
        ~10s each and none paginated: the business class closure, the bare
        pairs, and the direct P31 classes of every child and every parent. The
        type check happens here. (LIMIT/OFFSET paging was also unstable: two
        paginated passes still missed 848 of 190,834 pairs.)

        Pairs are dropped only when an end is explicitly a public body (see
        PUBLIC_SECTOR_CLASSES). Requiring a business class instead dropped 388
        real ownership edges — Parmalat to Lactalis, Lafarge to Holcim, Vinci
        Construction to Vinci — because those companies are typed only
        "organization".

        Names are not fetched: the label service over ~200K items is what made
        the old query expensive, and the writer only links companies that are
        already in the graph.
        """
        pairs = {
            (self._val(r, "child"), self._val(r, "parent"))
            for r in self._query("""
            SELECT ?child ?parent WHERE { ?child p:P749 ?stmt . ?stmt ps:P749 ?parent }
            """)
        }

        # Remember how these items are classified: stage 14 reuses it to flag
        # companies that are public bodies, without re-reading their classes.
        self.typed_items, self.public_sector_items = set(), set()

        def eligible(sparql: str) -> set:
            """Items with a class, minus the public-sector ones."""
            types: Dict[str, set] = {}
            for row in self._query(sparql):
                types.setdefault(self._val(row, "item"), set()).add(self._val(row, "type"))
            self.typed_items |= set(types)
            public = {q for q, classes in types.items() if self.is_public_sector(classes)}
            self.public_sector_items |= public
            return set(types) - public

        eligible_children = eligible("""
        SELECT DISTINCT ?item ?type WHERE { ?item p:P749 [] ; wdt:P31 ?type }
        """)
        eligible_parents = eligible("""
        SELECT DISTINCT ?item ?type WHERE { [] ps:P749 ?item . ?item wdt:P31 ?type }
        """)
        pairs = {(c, p) for c, p in pairs if c in eligible_children and p in eligible_parents}
        logger.info(f"  {len(self.public_sector_items)} public-sector items excluded; "
                    f"{len(pairs)} company-to-company P749 pairs")

        qualifiers_query = """
        SELECT ?child ?parent ?percentage ?refUrl WHERE {
          ?child p:P749 ?stmt .
          ?stmt ps:P749 ?parent .
          { ?stmt pq:P1107 ?percentage }
          UNION
          { ?stmt prov:wasDerivedFrom ?refNode . ?refNode pr:P854 ?refUrl }
        }
        """
        qualifiers: Dict[tuple, Dict[str, str]] = {}
        for row in self._query(qualifiers_query):
            q = qualifiers.setdefault((self._val(row, "child"), self._val(row, "parent")), {})
            for key in ("percentage", "refUrl"):
                val = row.get(key, {}).get("value")
                if val and key not in q:
                    q[key] = val

        rels = []
        for child_id, parent_id in sorted(pairs):
            q = qualifiers.get((child_id, parent_id), {})
            rels.append({
                "child_wikidata_id": child_id,
                "child_name": "",
                "parent_wikidata_id": parent_id,
                "parent_name": "",
                "source_url": q.get("refUrl"),
                "ownership_percentage": _ownership_percentage(q.get("percentage")),
            })
        logger.info(f"Stage 1: fetched {len(rels)} unique subsidiary relationships from Wikidata")
        return rels

    def fetch_company_shareholders(self) -> List[Dict]:
        """Minority stakes in companies we track: P127 statements carrying a share.

        Wikidata records shareholdings as "owned by" with a proportion (P1107):
        Vanguard 4.5% of Walmart, BlackRock 7.6% of Costco. They are not owners
        (fetch_brands drops them for that reason) but they are exactly what
        INVESTED_IN_BY is for. The older P749-plus-financial-class route found
        almost none, because Wikidata does not model shareholdings as parents.
        Current stakes only (no past end time), under 50%; one row per pair,
        the largest current stake if several are listed.
        """
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        best: Dict[tuple, Dict] = {}
        for row in self._query("""
        SELECT ?company ?holder ?pct ?end ?ref WHERE {
          ?company wdt:P1278 [] ; p:P127 ?st .
          ?st ps:P127 ?holder ; pq:P1107 ?pct ; wikibase:rank ?rk .
          FILTER(?rk != wikibase:DeprecatedRank)
          OPTIONAL { ?st pq:P582 ?end }
          OPTIONAL { ?st prov:wasDerivedFrom ?refNode . ?refNode pr:P854 ?ref }
        }
        """):
            end = self._val(row, "end")
            if end and end[:10] <= today:
                continue
            pct = _ownership_percentage(self._val(row, "pct"))
            if pct is None or not 0 < pct < self.CONTROLLING_SHARE:
                continue
            company, holder = self._val(row, "company"), self._val(row, "holder")
            if company == holder:
                continue
            cur = best.get((company, holder))
            if cur is None or pct > cur["ownership_percentage"]:
                best[(company, holder)] = {
                    "company_wikidata_id": company, "company_name": "",
                    "investor_wikidata_id": holder, "investor_name": "",
                    "ownership_percentage": round(pct, 4),
                    "source_url": self._val(row, "ref"), "wikidata_property": "P127",
                }
        logger.info(f"Stage 1: fetched {len(best)} current minority shareholdings (P127 with a share under 50%)")
        return list(best.values())

    def fetch_financial_entity_ids(self) -> set:
        """Fetch Wikidata IDs of institutional investors / financial entities.
        Used to filter P749 relationships that are shareholder stakes, not subsidiaries.
        """
        query = """
        SELECT DISTINCT ?entity WHERE {
          VALUES ?type {
            wd:Q1377101
            wd:Q180490
            wd:Q909498
            wd:Q170907
            wd:Q1531024
            wd:Q726884
            wd:Q4686041
          }
          ?entity wdt:P31 ?type .
        }
        LIMIT 50000
        """
        results = self._query(query)
        ids = {self._val(row, "entity") for row in results if self._val(row, "entity")}
        logger.info(f"Stage 1: fetched {len(ids)} financial entity IDs for investor filtering")
        return ids

    def fetch_people(self) -> List[Dict]:
        """Fetch founders, CEOs, board members of companies."""
        queries = {
            "founder": """
                SELECT ?person ?personLabel ?company ?companyLabel WHERE {
                  ?company wdt:P112 ?person .
                  ?company wdt:P1278 [] .
                  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul,de,fr,es,pt,it,nl,ja,zh,ko,ru,pl,sv,ar". }
                } LIMIT 50000
            """,
            "ceo": """
                SELECT ?person ?personLabel ?company ?companyLabel WHERE {
                  ?company wdt:P169 ?person .
                  ?company wdt:P1278 [] .
                  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul,de,fr,es,pt,it,nl,ja,zh,ko,ru,pl,sv,ar". }
                } LIMIT 50000
            """,
            "board_member": """
                SELECT ?person ?personLabel ?company ?companyLabel WHERE {
                  ?company wdt:P3320 ?person .
                  ?company wdt:P1278 [] .
                  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul,de,fr,es,pt,it,nl,ja,zh,ko,ru,pl,sv,ar". }
                } LIMIT 50000
            """,
        }
        all_people = []
        for role, q in queries.items():
            results = self._query(q)
            for row in results:
                all_people.append({
                    "person_wikidata_id": self._val(row, "person"),
                    "person_name": _clean_name(self._val(row, "personLabel") or ""),
                    "company_wikidata_id": self._val(row, "company"),
                    "company_name": _clean_name(self._val(row, "companyLabel") or ""),
                    "role": role,
                })
            logger.info(f"Stage 1: fetched {len(results)} {role}s")
            time.sleep(2)
        return all_people

    # ── Stage 4: Product IDs ─────────────────────────────────

    def fetch_product_ids(self) -> List[Dict]:
        """Fetch ASINs and UPC codes from Wikidata.
        Uses multi-language label fallback for brand names.
        """
        query = """
        SELECT ?product ?productLabel ?asin ?upc ?brand ?brandLabel WHERE {
          { ?product wdt:P5749 ?asin } UNION { ?product wdt:P3962 ?upc }
          OPTIONAL { ?product wdt:P176 ?brand }
          SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul,de,fr,es,pt,it,nl,ja,zh,ko,ru,pl,sv,ar". }
        }
        LIMIT 100000
        """
        results = self._query(query)
        products = []
        for row in results:
            products.append({
                "wikidata_id": self._val(row, "product"),
                "name": _clean_name(self._val(row, "productLabel") or ""),
                "asin": self._val(row, "asin"),
                "upc": self._val(row, "upc"),
                "brand_wikidata_id": self._val(row, "brand"),
                "brand_name": _clean_name(self._val(row, "brandLabel")),
            })
        logger.info(f"Stage 4: fetched {len(products)} product IDs from Wikidata")
        return products

    # ── Stage 14: Extended Properties ─────────────────────────

    def fetch_labels(self, qids, batch_size: int = 5000) -> Dict[str, str]:
        """Resolve item QIDs to display labels, a batch at a time.

        For large result sets this is much cheaper than running the label
        service inside the main query, which resolves every label on every row.
        """
        ids = sorted(q for q in qids if q and _is_qid(q))
        labels: Dict[str, str] = {}
        for i in range(0, len(ids), batch_size):
            values = " ".join(f"wd:{q}" for q in ids[i:i + batch_size])
            rows = self._query(f"""
            SELECT ?item ?itemLabel WHERE {{
              VALUES ?item {{ {values} }}
              SERVICE wikibase:label {{ bd:serviceParam wikibase:language "{LABEL_LANGUAGES}". }}
            }}
            """)
            for row in rows:
                label = _clean_name(self._val(row, "itemLabel") or "")
                if label and not _is_qid(label):
                    labels[self._val(row, "item")] = label
            time.sleep(1)
        return labels

    def fetch_lei_company_types(self) -> Dict[str, set]:
        """Instance-of (P31) classes of every company that has an LEI.

        Kept out of the extended-properties query: as another OPTIONAL there it
        multiplied that query's rows 3x (351K rows, 448MB) because each class
        repeats every other column.
        """
        types: Dict[str, set] = {}
        for row in self._query("""
        SELECT ?company ?type WHERE { ?company wdt:P1278 [] ; wdt:P31 ?type }
        """):
            types.setdefault(self._val(row, "company"), set()).add(self._val(row, "type"))
        return types

    def fetch_extended_properties(self) -> List[Dict]:
        """Fetch country, industry, HQ, employees, revenue, stock info.

        One unpaginated query without the label service (~15s for ~120K rows),
        then labels for the ~11K distinct countries, industries, cities and
        exchanges it references. With the label service inline, a 10,000-row
        page ran past WDQS's 60s limit and stage 14 failed every night.
        """
        query = """
        SELECT ?company ?lei ?country ?industry ?hqCity ?hqCountry
               ?website ?founded ?employees ?revenue ?exchange ?ticker ?isin
        WHERE {
          ?company wdt:P1278 ?lei .
          OPTIONAL { ?company wdt:P17 ?country }
          OPTIONAL { ?company wdt:P452 ?industry }
          OPTIONAL { ?company wdt:P159 ?hqCity . OPTIONAL { ?hqCity wdt:P17 ?hqCountry } }
          OPTIONAL { ?company wdt:P856 ?website }
          OPTIONAL { ?company wdt:P571 ?founded }
          OPTIONAL { ?company wdt:P1128 ?employees }
          OPTIONAL { ?company wdt:P2139 ?revenue }
          OPTIONAL { ?company wdt:P414 ?exchange }
          OPTIONAL { ?company wdt:P249 ?ticker }
          OPTIONAL { ?company wdt:P946 ?isin }
        }
        """
        results = self._query(query)
        labelled = ("country", "industry", "hqCity", "hqCountry", "exchange")
        labels = self.fetch_labels({self._val(r, k) for r in results for k in labelled})
        label = lambda row, key: labels.get(self._val(row, key))
        extended = []
        for row in results:
            emp = self._val(row, "employees")
            rev = self._val(row, "revenue")
            extended.append({
                "lei": self._val(row, "lei"),
                "wikidata_id": self._val(row, "company"),
                "country": label(row, "country"),
                "industry": label(row, "industry"),
                "hq_city": label(row, "hqCity"),
                "hq_country": label(row, "hqCountry"),
                "website": self._val(row, "website"),
                "founded": self._val(row, "founded"),
                "employees": int(float(emp)) if emp else None,
                "revenue": float(rev) if rev else None,
                "stock_exchange": label(row, "exchange"),
                "ticker": self._val(row, "ticker"),
                "isin": self._val(row, "isin"),
            })
        logger.info(f"Stage 14: fetched {len(extended)} extended property sets from Wikidata")
        return extended
