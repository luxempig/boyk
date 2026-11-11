"""
Stage 7: FEC corporate PAC contributions to federal candidates.

The earlier stage searched individual contributions by the donor's employer,
which shows employees' personal donations as the company's own. This reads
what a company's PAC gave instead, from FEC's public-domain bulk files:

  cm{yy}  committee master — each PAC's connected organization (CONNECTED_ORG_NM)
          and whether that organization is a corporation (ORG_TP C or W);
  pas2{yy} committee-to-candidate transactions — direct contributions only
          (24K, and 24Z in kind). Independent expenditures (24E/24A) are left
          out: they are spent about a candidate, for or against, not given;
  cn{yy}  candidate master — name, party, state and office.

One row per (connected organization, candidate): the total of the most recent
cycle in which the PAC gave to that candidate.
"""
import csv
import io
import logging
import zipfile
from collections import defaultdict
from datetime import datetime, timezone
from typing import Dict, List

import requests

logger = logging.getLogger(__name__)

BULK = "https://www.fec.gov/files/bulk-downloads/{year}/{name}{yy}.zip"
CORPORATE_ORG_TYPES = {"C", "W"}          # corporation; corporation without capital stock
DIRECT_CONTRIBUTIONS = {"24K", "24Z"}
OFFICES = {"H": "House", "S": "Senate", "P": "President"}

CM = ["CMTE_ID", "CMTE_NM", "TRES_NM", "CMTE_ST1", "CMTE_ST2", "CMTE_CITY", "CMTE_ST", "CMTE_ZIP",
      "CMTE_DSGN", "CMTE_TP", "CMTE_PTY_AFFILIATION", "CMTE_FILING_FREQ", "ORG_TP", "CONNECTED_ORG_NM", "CAND_ID"]
CN = ["CAND_ID", "CAND_NAME", "CAND_PTY_AFFILIATION", "CAND_ELECTION_YR", "CAND_OFFICE_ST", "CAND_OFFICE",
      "CAND_OFFICE_DISTRICT", "CAND_ICI", "CAND_STATUS", "CAND_PCC", "CAND_ST1", "CAND_ST2", "CAND_CITY",
      "CAND_ST", "CAND_ZIP"]
PAS2 = ["CMTE_ID", "AMNDT_IND", "RPT_TP", "TRANSACTION_PGI", "IMAGE_NUM", "TRANSACTION_TP", "ENTITY_TP", "NAME",
        "CITY", "STATE", "ZIP_CODE", "EMPLOYER", "OCCUPATION", "TRANSACTION_DT", "TRANSACTION_AMT", "OTHER_ID",
        "CAND_ID", "TRAN_ID", "FILE_NUM", "MEMO_CD", "MEMO_TEXT", "SUB_ID"]


def _rows(session: requests.Session, name: str, cycle: int, columns: List[str]):
    url = BULK.format(year=cycle, name=name, yy=str(cycle)[2:])
    resp = session.get(url, timeout=120)
    resp.raise_for_status()
    with zipfile.ZipFile(io.BytesIO(resp.content)) as z:
        member = next(n for n in z.namelist() if n.lower().endswith(".txt"))
        with z.open(member) as f:
            for rec in csv.reader(io.TextIOWrapper(f, encoding="latin-1"), delimiter="|", quoting=csv.QUOTE_NONE):
                if len(rec) >= len(columns):
                    yield dict(zip(columns, rec))


def current_cycles(today=None) -> List[int]:
    """The current two-year cycle and the one before (FEC files a cycle under its even year)."""
    year = (today or datetime.now(timezone.utc)).year
    cycle = year if year % 2 == 0 else year + 1
    return [cycle, cycle - 2]


def fetch_pac_donations(cycles: List[int] = None) -> List[Dict]:
    session = requests.Session()
    session.headers.update({"User-Agent": "BoykETL/2.0 (https://boyk.org)"})
    totals: Dict[tuple, float] = defaultdict(float)         # (org, cand, cycle) -> $
    committees: Dict[tuple, str] = {}                        # (org, cand) -> a committee id, for the source link
    candidates: Dict[str, Dict] = {}
    for cycle in cycles or current_cycles():
        pacs = {r["CMTE_ID"]: r["CONNECTED_ORG_NM"].strip()
                for r in _rows(session, "cm", cycle, CM)
                if r["ORG_TP"] in CORPORATE_ORG_TYPES and r["CONNECTED_ORG_NM"].strip()}
        n = 0
        for r in _rows(session, "pas2", cycle, PAS2):
            org = pacs.get(r["CMTE_ID"])
            if not org or r["TRANSACTION_TP"] not in DIRECT_CONTRIBUTIONS or r["MEMO_CD"] == "X" or not r["CAND_ID"]:
                continue
            try:
                amount = float(r["TRANSACTION_AMT"])
            except ValueError:
                continue
            totals[(org, r["CAND_ID"], cycle)] += amount
            committees.setdefault((org, r["CAND_ID"]), r["CMTE_ID"])
            n += 1
        logger.info(f"Stage 7: {cycle} cycle: {len(pacs):,} corporate PACs, {n:,} direct contributions")

    # A senator not up this cycle files under the cycle they last ran in, so
    # the candidate list has to reach back; the newest record wins.
    first = max(cycles or current_cycles())
    for cycle in range(first + 2, first - 14, -2):
        try:
            for r in _rows(session, "cn", cycle, CN):
                candidates.setdefault(r["CAND_ID"], r)
        except requests.HTTPError:
            continue                      # a future cycle not published yet
    latest: Dict[tuple, tuple] = {}
    for (org, cand, cycle), amount in totals.items():
        if amount > 0 and ((org, cand) not in latest or cycle > latest[(org, cand)][0]):
            latest[(org, cand)] = (cycle, amount)
    out = []
    unknown = 0
    for (org, cand), (cycle, amount) in latest.items():
        c = candidates.get(cand)
        if not c:
            # Filers sometimes enter a candidate ID FEC itself has no record of
            # (S4NE00173); with no name to show, the gift cannot be attributed.
            unknown += 1
            continue
        out.append({
            "company_name": org,
            "fec_id": cand,
            "politician_name": c.get("CAND_NAME", ""),
            "party": c.get("CAND_PTY_AFFILIATION", ""),
            "state": c.get("CAND_OFFICE_ST", ""),
            "office": OFFICES.get(c.get("CAND_OFFICE", ""), c.get("CAND_OFFICE", "")),
            "amount": round(amount, 2),
            "year": cycle,
            "source_url": f"https://www.fec.gov/data/committee/{committees[(org, cand)]}/",
            "source_record_id": f"{committees[(org, cand)]}|{cand}|{cycle}",
            "matched_by": "fec_connected_org",
        })
    logger.info(f"Stage 7: {len(out):,} corporate PAC -> candidate pairs "
                f"({unknown:,} skipped: candidate ID unknown to FEC)")
    return out
