#!/usr/bin/env python3
"""Build the Open Food Facts barcode->brand lookup index + ODbL extract.

Reads the official OFF CSV export, matches each product's brand and its
brand_owner against the knowledge graph's Brand/Company nodes (resolve-only —
never mints graph nodes), and emits:

  out/offidx/{prefix}.json        sharded barcode index for R2 (worker fallback)
  out/extract/boyk-off-brand-extract.csv.gz   the ODbL-published derived extract
  out/extract/README.txt          license + attribution notice
  out/report.json                 totals + match rates

Two things decide whether a scan names a company:
  1. the brand resolves to a Brand that has an owner, or
  2. the product's brand_owner string resolves to a Company.
Only (1) existed before, and 86% of graph brands have no owner, so most scans
stopped at a brand name.

The source is the CSV export rather than the Hugging Face Parquet because the
Parquet has no brand_owner column (its `owner` is the producer-platform
account), and because Hugging Face rate-limits anonymous reads.

License: data (c) Open Food Facts contributors, ODbL 1.0. Our obligations:
attribution with link in the app, and publishing this derived extract under ODbL.

Usage:
  curl -L -o off-products.csv.gz \\
    https://static.openfoodfacts.org/data/en.openfoodfacts.org.products.csv.gz
  python3 export_match_data.py
  python3 build.py --csv off-products.csv.gz [--limit N]
"""
import argparse, csv, gzip, io, json, os, re, sys, unicodedata
from collections import defaultdict

# The recall/EPA/OFAC name matcher: one definition of "the same company".
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "etl"))
from enrichment.firm_match import _core, _tokens  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")

NORM_RE = re.compile(r"[^a-z0-9]+")


def norm(s: str) -> str:
    """Fold accents, then strip to letters and digits.

    Without the folding, "Nestlé" keys as "nestl" and never meets OFF's
    "NESTLE"; 6% of brand names and 16% of company names in the graph carry
    non-ASCII characters, including most European food and beauty groups.
    """
    if not s:
        return ""
    decomposed = unicodedata.normalize("NFKD", s)
    ascii_only = "".join(c for c in decomposed if not unicodedata.combining(c))
    return NORM_RE.sub("", ascii_only.lower())


# Words that trail a company name without naming a different company. Kept
# deliberately short: "foods", "markets" and "products" stay meaningful, because
# "Lowe's Food Stores" is a grocery chain and not Lowe's.
TRAILING_WORDS = {"stores", "store", "sales", "company", "companies", "group", "holdings",
                  "holding", "associates", "enterprises", "distributors", "distributing",
                  "industries", "international", "intl", "int", "inc", "usa", "us",
                  "america", "american", "na"}

# Placeholders that name no company. FDC uses them where a brand owner is
# unknown or the product is unbranded.
NON_OWNERS = {"notabrandeditem", "notbranded", "privatelabel", "private", "unknown",
              "none", "na", "generic", "nobrand", "store", "storebrand"}

# A brand's owner counts as backed by USDA only when it (or its group) is
# declared on at least this share of the brand's US barcodes.
MIN_BRAND_SUPPORT = 0.25

# "Mondelez Int. US (0074819091009)" — FDC appends the GS1 prefix to some owners.
PARENTHETICAL_RE = re.compile(r"\s*\([^)]*\)\s*$")


def loose_key(s: str) -> str:
    """Name without its legal form, trailing corporate words or a trailing plural.

    "Wal-Mart Stores, Inc." -> "walmart", "GENERAL MILLS SALES INC." -> "generalmills",
    "Tops Markets, LLC" -> "topsmarket" (which is how the graph spells it).
    """
    tokens = _core(_tokens(norm_spaces(PARENTHETICAL_RE.sub("", s or ""))))
    while len(tokens) > 1 and tokens[-1] in TRAILING_WORDS:
        tokens.pop()
    if tokens and len(tokens[-1]) > 3 and tokens[-1].endswith("s"):
        tokens[-1] = tokens[-1][:-1]
    return norm(" ".join(tokens))


def core_key(s: str) -> str:
    """Name without its legal form: "NESTLE USA, INC." -> "nestleusa"."""
    return norm(" ".join(_core(_tokens(norm_spaces(s)))))


def norm_spaces(s: str) -> str:
    """Accent-folded but still word-separated, for tokenising."""
    decomposed = unicodedata.normalize("NFKD", s or "")
    return "".join(c for c in decomposed if not unicodedata.combining(c))


def build_lookup(match_data_path: str):
    """norm(name) -> match dict; collisions across DIFFERENT entities -> ambiguous."""
    data = json.load(open(match_data_path))
    lookup, ambiguous = {}, set()
    rank = {c["id"]: c.get("rank", 0) for c in data["companies"]}

    def add(key, entry):
        if not key or len(key) < 3:
            return
        cur = lookup.get(key)
        if cur is None:
            lookup[key] = entry
        elif cur["id"] == entry["id"]:
            # One brand, several owners (one row each): "Kellogg's" is Kellanova's
            # worldwide and WK Kellogg's in North America. A name can't tell the
            # region, so take the larger group, deterministically rather than by
            # export row order; a product's own USDA owner still overrides it.
            if entry.get("cid") and rank.get(entry["cid"], 0) > rank.get(cur.get("cid"), -1):
                lookup[key] = entry
        elif cur["id"] != entry["id"]:
            # prefer brand over company on collision; same-type collision = ambiguous
            if cur["t"] == "brand" and entry["t"] == "company":
                return
            if cur["t"] == "company" and entry["t"] == "brand":
                lookup[key] = entry
                return
            ambiguous.add(key)

    for b in data["brands"]:
        if not b.get("name"):
            continue
        add(norm(b["name"]), {
            "t": "brand", "id": b.get("qid"), "name": b["name"],
            "cid": b.get("company_id"), "cname": b.get("company_name"),
        })
    for c in data["companies"]:
        add(norm(c["name"]), {"t": "company", "id": c["id"], "name": c["name"]})

    for k in ambiguous:
        lookup.pop(k, None)
    return lookup, len(ambiguous)


def build_relatives(match_data_path: str):
    """related(a, b): the two companies share a corporate group in the graph.

    Harris Teeter and Kroger disagree only in how far up the tree they stop, so
    both are right; Weis Markets and Unilever do not share a group at all.
    """
    from functools import lru_cache
    parents = defaultdict(set)
    for child, parent in json.load(open(match_data_path)).get("relations", []):
        parents[child].add(parent)

    @lru_cache(maxsize=None)
    def group(x: str) -> frozenset:
        seen, frontier = {x}, {x}
        for _ in range(8):
            frontier = {p for f in frontier for p in parents.get(f, ())} - seen
            if not frontier:
                break
            seen |= frontier
        return frozenset(seen)

    return lambda a, b: a == b or bool(group(a) & group(b))


def build_owner_lookup(match_data_path: str):
    """Company-name keys for resolving OFF's brand_owner strings.

    Keyed twice: by the folded name, and by the name minus its legal form, so
    "NESTLE USA, INC." reaches "Nestlé USA". A key claimed by two different
    companies is dropped rather than guessed — the wrong parent company is a
    worse answer than no parent company.
    """
    data = json.load(open(match_data_path))
    exact, loose = {}, {}
    dropped = 0

    def add(table, key, entry):
        nonlocal dropped
        if not key or len(key) < 3:
            return
        cur = table.get(key)
        if cur is None:
            table[key] = entry
        elif cur["id"] != entry["id"]:
            # Two companies spell their name the same way — "Safeway" is two
            # legal entities. Keep the one a shopper means: the one carrying
            # more brands and subsidiaries. Dropping the key instead answered
            # "no company" for names as common as Safeway and Unilever.
            if entry["rank"] > cur["rank"] or (
                    entry["rank"] == cur["rank"] and entry["id"] < cur["id"]):
                table[key] = entry
            dropped += 1

    for c in data["companies"]:
        name = c.get("name")
        if not name:
            continue
        entry = {"id": c["id"], "name": name, "rank": c.get("rank") or 0}
        for key in {norm(name), core_key(name)}:
            add(exact, key, entry)
        add(loose, loose_key(name), entry)

    strip_rank = lambda t: {k: {"id": v["id"], "name": v["name"]} for k, v in t.items()}
    return strip_rank(exact), strip_rank(loose), dropped


def load_owner_aliases(path: str, match_data_path: str, exact: dict) -> int:
    """Add hand-checked owner spellings to the exact owner table.

    owner_aliases.json maps an owner string as USDA/OFF write it to the graph
    company it names, with the evidence for the link. Name rules alone can't
    reach these ("CAMPBELL SOUP COMPANY" vs the graph's "Campbell's"), and the
    automatic prefix rule that tried was wrong about one time in seven. An
    alias whose company is no longer in the graph is skipped, not guessed.
    """
    if not os.path.exists(path):
        return 0
    known = {c["id"]: c["name"] for c in json.load(open(match_data_path))["companies"]}
    added = 0
    for a in json.load(open(path)):
        cid = a["company_id"]
        if cid not in known:
            print(f"  alias skipped, company not in graph: {a['owner']!r} -> {cid}", flush=True)
            continue
        entry = {"id": cid, "name": known[cid]}
        # Brands the owner string also appears on without owning them (a
        # packer's co-packed or licensed lines) stay unresolved.
        excluded = {norm(b) for b in a.get("exclude_brands", []) if norm(b)}
        for key in {norm(a["owner"]), core_key(a["owner"])}:
            if key and len(key) >= 3:
                exact[key] = entry
                if excluded:
                    ALIAS_EXCLUDED_BRANDS[key] = excluded
        added += 1
    return added


ALIAS_EXCLUDED_BRANDS = {}   # owner key -> brand keys the alias must not claim


def resolve_owner(owner_raw: str, exact: dict, loose: dict = None, brand: str = ""):
    """Resolve an OFF brand_owner string to a graph company, or None.

    Tried in order of how much of the string is ignored: the name as written,
    the name minus its legal form, then minus trailing corporate words.
    """
    if not owner_raw or norm(owner_raw) in NON_OWNERS:
        return None
    if brand and any(norm(brand) in ALIAS_EXCLUDED_BRANDS.get(k, ())
                     for k in (norm(owner_raw), core_key(owner_raw))):
        return None
    hit = exact.get(norm(owner_raw)) or exact.get(core_key(owner_raw))
    if hit or loose is None:
        return hit
    return loose.get(loose_key(owner_raw))


def key13(code: str) -> str:
    """Barcode in the spelling the worker's third candidate uses.

    Scanners and datasets disagree about leading zeros (UPC-A vs EAN-13). The
    worker tries the code as scanned, stripped of zeros, and padded to 13, so
    storing the padded form is reachable from any of them.
    """
    # Datasets write UPCs with hyphens and spaces ("0-41415-00936-3"); scanners
    # send bare digits, so anything else is unreachable.
    digits = re.sub(r"\D", "", code or "")
    return digits.lstrip("0").rjust(13, "0") if digits else ""


def fdc_records(zip_path: str) -> dict:
    """{key13(barcode): [(gtin, brand, owner, description), ...]}, newest first.

    FoodData Central is a US government work in the public domain, and unlike
    Open Food Facts it carries brand_owner on nearly every row, which is the
    field that decides whether a scan can name a company.

    FDC keeps every release of a product (~4.8 records per barcode) and owners
    change - French's moved from Reckitt to McCormick - so the caller takes the
    newest record whose owner resolves. Newest only is not enough: newer
    releases often leave brand_owner blank (Silk, Good & Gather) or spell it as
    a subsidiary the graph lacks ("Pepsi-Cola North America Inc."), and an older
    record's "PepsiCo, Inc." is still the right company.
    """
    import zipfile
    records = defaultdict(list)
    with zipfile.ZipFile(zip_path) as z:
        names = z.namelist()
        branded = next(n for n in names if n.endswith("branded_food.csv"))
        food = next((n for n in names if n.endswith("food.csv")), None)

        descriptions = {}
        if food:
            with z.open(food) as f:
                reader = csv.DictReader(io.TextIOWrapper(f, encoding="utf-8", errors="replace"))
                for row in reader:
                    desc = (row.get("description") or "").strip()
                    if desc:
                        descriptions[row.get("fdc_id")] = desc

        with z.open(branded) as f:
            reader = csv.DictReader(io.TextIOWrapper(f, encoding="utf-8", errors="replace"))
            for row in reader:
                gtin = (row.get("gtin_upc") or "").strip()
                key = key13(gtin)
                if not key:
                    continue
                brand = (row.get("brand_name") or "").strip()
                owner = (row.get("brand_owner") or "").strip()
                if not brand and not owner:
                    continue
                fid = row.get("fdc_id") or ""
                rank = (row.get("modified_date") or row.get("available_date") or "",
                        int(fid) if fid.isdigit() else 0)
                records[key].append((rank, (gtin, brand, owner, descriptions.get(fid, ""))))
    return {k: [r for _, r in sorted(v, reverse=True)] for k, v in records.items()}


def rows_from_fdc(zip_path: str):
    """Yield (gtin, brand, owner, description): each barcode's newest record naming an owner."""
    for recs in fdc_records(zip_path).values():
        yield next((r for r in recs if r[2]), recs[0])


def rows_from_csv(path: str, limit: int = 0):
    """Yield (code, brands, brand_owner, product_name) from the OFF export.

    The export is tab separated and unquoted: a product name containing a quote
    character is data, not a quoting construct.
    """
    csv.field_size_limit(sys.maxsize)
    opener = gzip.open if path.endswith(".gz") else open
    with opener(path, "rt", encoding="utf-8", errors="replace", newline="") as f:
        reader = csv.DictReader(f, delimiter="\t", quoting=csv.QUOTE_NONE)
        for i, row in enumerate(reader):
            if limit and i >= limit:
                return
            yield (row.get("code") or "", row.get("brands") or "",
                   row.get("brand_owner") or "", row.get("product_name") or "")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", default=os.path.join(HERE, "off-products.csv.gz"))
    ap.add_argument("--fdc", default="", help="FoodData Central branded-food zip (optional)")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--match-data", default="/tmp/graph-match-data.json")
    args = ap.parse_args()

    lookup, n_ambiguous = build_lookup(args.match_data)
    owners, owners_loose, n_owner_ambiguous = build_owner_lookup(args.match_data)
    related = build_relatives(args.match_data)
    n_aliases = load_owner_aliases(os.path.join(HERE, "owner_aliases.json"), args.match_data, owners)
    print(f"lookup entries: {len(lookup):,} (dropped {n_ambiguous} ambiguous); "
          f"owner keys: {len(owners):,} exact + {len(owners_loose):,} loose "
          f"({n_owner_ambiguous} name collisions broken by rank); "
          f"{n_aliases} curated owner aliases", flush=True)

    shards = defaultdict(dict)
    extract_rows = []
    seen = {}            # key13(barcode) -> (shard prefix, stored code)
    total = brand_matched = company_via_brand = company_via_owner = 0
    fdc_added = fdc_upgraded = fdc_company = 0
    fdc_overrode = defaultdict(int)
    extract_at = {}      # stored code -> index in extract_rows, so FDC fixes reach the extract

    for code, brands, brand_owner, pname in rows_from_csv(args.csv, args.limit):
        code = re.sub(r"\D", "", code or "")
        if not code or not brands.strip():
            continue
        # A brands field of only separators carries no brand.
        candidates = [b.strip() for b in brands.split(",") if b.strip()]
        if not candidates:
            continue
        total += 1
        # Products list several brands; take the first that the graph knows.
        brand_raw = candidates[0]
        match = None
        for cand in candidates:
            match = lookup.get(norm(cand))
            if match:
                brand_raw = cand
                break
        if match:
            brand_matched += 1

        company = None
        if match and match.get("cid"):
            company = {"id": match["cid"], "name": match.get("cname")}
            company_via_brand += 1
        else:
            owner = resolve_owner(brand_owner, owners, owners_loose, brand_raw)
            if owner:
                company = owner
                company_via_owner += 1
                if match:
                    match = {**match, "cid": owner["id"], "cname": owner["name"]}
                else:
                    match = {"t": "company", "id": owner["id"], "name": owner["name"]}

        entry = [pname or "", brand_raw, match if match else 0]
        prefix = code[:3] if len(code) >= 3 else code
        shards[prefix][code] = entry
        seen[key13(code)] = (prefix, code)
        extract_at[code] = len(extract_rows)
        extract_rows.append((code, brand_raw, (match or {}).get("id", ""),
                             (match or {}).get("t", ""), (company or {}).get("id", ""), "off"))
        if total % 500_000 == 0:
            print(f"  processed {total:,} (brand {brand_matched:,}, "
                  f"company {company_via_brand + company_via_owner:,})", flush=True)

    if args.fdc:
        print(f"reading FoodData Central: {args.fdc}", flush=True)
        records = fdc_records(args.fdc)
        # For each brand, the companies USDA records declare as its owner. A
        # name-only brand match that none of them backs (no US record ties
        # "Springfield" to Tendam, the Spanish fashion group) is a collision.
        declared_for_brand = defaultdict(set)
        declared_count = defaultdict(lambda: defaultdict(int))   # brand -> owner -> barcodes
        fdc_rows = []
        for recs in records.values():
            # Each field from its newest non-blank value: releases blank out
            # different fields (Cheez-It's newest record names an owner but no
            # brand), so taking one whole record drops the product.
            owner_pick = None
            counted = set()
            for gtin, brand, owner, desc in recs:
                o = resolve_owner(owner, owners, owners_loose, brand) if owner else None
                if o and brand:
                    declared_for_brand[norm(brand)].add(o["id"])
                # Unresolved owners count too, under their raw name: most
                # "Kellogg's" records say "Kellogg Company US", which must stop
                # the WK Kellogg minority looking unanimous.
                who = o["id"] if o else ("?" + norm(owner) if norm(owner) else None)
                if brand and who and (norm(brand), who) not in counted:
                    counted.add((norm(brand), who))
                    declared_count[norm(brand)][who] += 1
                if o and owner_pick is None:
                    owner_pick = owner                        # newest owner that resolves
            newest = lambda i: next((r[i] for r in recs if r[i]), "")
            # The brand is identity, not ownership, so any release's spelling
            # will do: the newest the graph knows, as with OFF's brand list
            # ("Kellogg's Cheez It" is newest, "CHEEZ-IT" is the one that matches).
            brand_pick = next((r[1] for r in recs if r[1] and norm(r[1]) in lookup), newest(1))
            fdc_rows.append((recs[0][0], brand_pick, owner_pick or newest(2), newest(3)))
        del records

        def override_reason(current_id, company, owner, entry_brand, fdc_brand):
            if related(company["id"], current_id):
                return None                       # same group: keep the ultimate parent
            b = norm(entry_brand)
            if len(b) >= 3 and (norm(company["name"]).startswith(b) or norm(owner).startswith(b)):
                return "store_brand"              # "Weis" sold by Weis Markets
            # Backing must be a real share of the brand's US records, not a
            # stray one: Dreyer's makes Kit Kat ice cream under Nestlé's licence,
            # but Hershey declares Kit Kat on far more barcodes, and those are
            # the candy bars people scan.
            counts = declared_count.get(b) or declared_count.get(norm(fdc_brand)) or {}
            total = sum(counts.values())
            if total:
                support = sum(n for who, n in counts.items()
                              if not who.startswith("?") and related(who, current_id))
                if support / total < MIN_BRAND_SUPPORT:
                    return "uncorroborated"
                return None
            backers = declared_for_brand.get(b, set()) | declared_for_brand.get(norm(fdc_brand), set())
            if not any(related(x, current_id) for x in backers):
                return "uncorroborated"           # no US record supports the brand match
            return None

        fdc_spoke = set()
        for i, (gtin, brand, owner, desc) in enumerate(fdc_rows, 1):
            company = resolve_owner(owner, owners, owners_loose, brand)
            known = seen.get(key13(gtin))
            if known:
                fdc_spoke.add(known[1])
                # Open Food Facts already has this barcode. Only fill in a
                # company it could not name; its brand and product name stay.
                prefix, code = known
                entry = shards[prefix][code]
                current = entry[2] or None
                if company and not (current or {}).get("cid") and (current or {}).get("t") != "company":
                    if current:
                        entry[2] = {**current, "cid": company["id"], "cname": company["name"]}
                    else:
                        entry[2] = {"t": "company", "id": company["id"], "name": company["name"]}
                    fdc_upgraded += 1
                elif company and current:
                    # Both name a company and they disagree. The declared owner
                    # is the manufacturer's own statement about this product;
                    # the brand match is a name. See override_reason.
                    current_id = current.get("cid") or (current["id"] if current.get("t") == "company" else None)
                    reason = current_id and current_id != company["id"] and \
                        override_reason(current_id, company, owner, entry[1], brand)
                    if reason:
                        entry[2] = {"t": "company", "id": company["id"], "name": company["name"]}
                        fdc_overrode[reason] += 1
                if code in extract_at:
                    m = entry[2] or {}
                    cid = m.get("cid") or (m.get("id") if m.get("t") == "company" else "")
                    row = extract_rows[extract_at[code]]
                    extract_rows[extract_at[code]] = (row[0], row[1], m.get("id", ""), m.get("t", ""), cid or "", row[5])
                continue
            if not brand and not company:
                continue
            match = 0
            hit = lookup.get(norm(brand)) if brand else None
            if company and hit and hit.get("cid") and hit["cid"] != company["id"] and \
                    not override_reason(hit["cid"], company, owner, brand, brand):
                # The same test as for Open Food Facts barcodes, the other way
                # round: a brand USDA's own records back keeps its owner. The
                # declared owner here is often the packer ("Seaboard Foods" on
                # Publix pork).
                match = hit
                fdc_company += 1
                fdc_overrode["brand_backed"] += 1
            elif company:
                match = {"t": "company", "id": company["id"], "name": company["name"]}
                fdc_company += 1
            else:
                if hit:
                    match = hit
                    if hit.get("cid"):
                        fdc_company += 1
            code = key13(gtin)
            prefix = code[:3]
            # A 4th element marks the entry as USDA's: public domain, so the
            # worker must not credit it to Open Food Facts. OFF entries keep
            # three elements (one filled in from FDC still shows OFF's name
            # and brand, so it still needs OFF's credit).
            shards[prefix][code] = [desc or "", brand or owner, match, "fdc"]
            seen[code] = (prefix, code)
            fdc_added += 1
            extract_rows.append((code, brand or owner, (match or {}).get("id", ""),
                                 (match or {}).get("t", ""), (company or {}).get("id", ""), "fdc"))
            if i % 500_000 == 0:
                print(f"  FDC {i:,} rows (added {fdc_added:,}, filled {fdc_upgraded:,})", flush=True)

    if args.fdc:
        # US/Canada-issued barcodes that no FDC record covers, whose brand match
        # names a company no USDA record for that brand backs. When USDA's
        # records for the brand agree on one owner, that owner is the evidence:
        # every one of 1,496 "Weis" records names Weis Markets, none Unilever
        # (whose "Weis" is Australian ice cream). Barcodes issued elsewhere keep
        # their match - a Danish Toms bar is Toms Group's.
        company_name = {c["id"]: c["name"] for c in json.load(open(args.match_data))["companies"]}
        for prefix, entries in shards.items():
            for code, entry in entries.items():
                if len(entry) > 3 or code in fdc_spoke or not entry[2]:
                    continue
                m = entry[2]
                current_id = m.get("cid") or (m["id"] if m.get("t") == "company" else None)
                counts = declared_count.get(norm(entry[1]))
                if not current_id or not counts:
                    continue
                c13 = code.rjust(13, "0")
                if not (c13.isdigit() and int(c13[:3]) <= 139):   # GS1 000-139: US/Canada
                    continue
                declared = sum(counts.values())
                top, n = max(counts.items(), key=lambda kv: kv[1])
                if n < 20 or n < 0.9 * declared or top not in company_name:
                    continue
                # As in override_reason: a stray licensee record (Nestlé's Kit
                # Kat ice cream) doesn't make the current owner a backer.
                support = sum(k for who, k in counts.items()
                              if not who.startswith("?") and related(who, current_id))
                if support / declared >= MIN_BRAND_SUPPORT:
                    continue
                entry[2] = {"t": "company", "id": top, "name": company_name[top]}
                fdc_overrode["brand_consensus"] += 1
                if code in extract_at:
                    row = extract_rows[extract_at[code]]
                    extract_rows[extract_at[code]] = (row[0], row[1], top, "company", top, row[5])

    # Start from an empty shard directory: the upload publishes every file in
    # it, so a shard a previous build wrote and this one didn't would go live.
    shard_dir = os.path.join(OUT, "offidx")
    if os.path.isdir(shard_dir):
        for name in os.listdir(shard_dir):
            if name.endswith(".json"):
                os.remove(os.path.join(shard_dir, name))
    os.makedirs(shard_dir, exist_ok=True)
    os.makedirs(os.path.join(OUT, "extract"), exist_ok=True)

    for prefix, entries in shards.items():
        safe = re.sub(r"[^0-9A-Za-z]", "_", prefix)
        with open(os.path.join(OUT, "offidx", f"{safe}.json"), "w") as f:
            json.dump(entries, f, separators=(",", ":"))

    extract_path = os.path.join(OUT, "extract", "boyk-off-brand-extract.csv.gz")
    with gzip.open(extract_path, "wt", newline="") as f:
        w = csv.writer(f)
        w.writerow(["barcode", "brand", "matched_entity_id", "matched_entity_type",
                    "matched_company_id", "source"])
        w.writerows(extract_rows)

    with open(os.path.join(OUT, "extract", "README.txt"), "w") as f:
        f.write(
            "Boyk barcode->brand extract\n"
            "Derived from the Open Food Facts database (https://world.openfoodfacts.org),\n"
            "(c) Open Food Facts contributors, and from Boyk's entity matching.\n"
            "Rows with source=fdc come from USDA FoodData Central\n"
            "(https://fdc.nal.usda.gov), a US government work in the public domain.\n"
            "Licensed under the Open Database License (ODbL) v1.0:\n"
            "https://opendatacommons.org/licenses/odbl/1-0/\n"
            "You are free to share, modify, and use this database provided you\n"
            "attribute the sources and share derivative databases alike.\n"
        )

    reached = company_via_brand + company_via_owner + fdc_company + fdc_upgraded
    report = {
        "total_products": total + fdc_added,
        "off_products": total,
        "brand_matched": brand_matched,
        "brand_match_rate": round(brand_matched / total, 4) if total else 0,
        "company_reached": reached,
        "company_reach_rate": round(reached / (total + fdc_added), 4) if total else 0,
        "company_via_brand_owner_edge": company_via_brand,
        "company_via_off_brand_owner": company_via_owner,
        "fdc_barcodes_added": fdc_added,
        "fdc_companies_on_new_barcodes": fdc_company,
        "fdc_companies_filled_on_off_barcodes": fdc_upgraded,
        "fdc_owner_overrode_store_brand": fdc_overrode["store_brand"],
        "fdc_owner_overrode_uncorroborated": fdc_overrode["uncorroborated"],
        "fdc_brand_consensus_overrode": fdc_overrode["brand_consensus"],
        "fdc_brand_backed_kept_over_owner": fdc_overrode["brand_backed"],
        "shards": len(shards),
        "lookup_entries": len(lookup),
        "ambiguous_dropped": n_ambiguous,
        "owner_keys": len(owners),
        "owner_ambiguous_dropped": n_owner_ambiguous,
    }
    with open(os.path.join(OUT, "report.json"), "w") as f:
        json.dump(report, f, indent=2)
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    sys.exit(main())
