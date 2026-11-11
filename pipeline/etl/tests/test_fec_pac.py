import io
import zipfile
from unittest.mock import MagicMock, patch

from enrichment import fec_pac


def _zip(rows):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("data.txt", "\n".join("|".join(r) for r in rows))
    return buf.getvalue()


def _cm(cid, org_tp, org):
    r = [""] * len(fec_pac.CM)
    r[0], r[12], r[13] = cid, org_tp, org
    return r


def _cn(cand, name):
    r = [""] * len(fec_pac.CN)
    r[0], r[1], r[2], r[4], r[5] = cand, name, "DEM", "TX", "S"
    return r


def _pas2(cid, tp, cand, amt, memo=""):
    r = [""] * len(fec_pac.PAS2)
    r[0], r[5], r[14], r[16], r[19] = cid, tp, str(amt), cand, memo
    return r


def test_pac_giving_is_corporate_direct_and_latest_cycle():
    files = {
        ("cm", 2026): [_cm("C1", "C", "LOCKHEED MARTIN CORPORATION"), _cm("C2", "L", "TEAMSTERS")],
        ("cn", 2026): [],
        ("pas2", 2026): [
            _pas2("C1", "24K", "S1", 5000),
            _pas2("C1", "24K", "S1", 2500),
            _pas2("C1", "24K", "S1", 999, memo="X"),     # memo line repeats another entry
            _pas2("C1", "24E", "S1", 100000),             # independent expenditure: not a gift
            _pas2("C2", "24K", "S1", 7000),               # labor PAC: not a company
            _pas2("C1", "24K", "S9BOGUS01", 400),          # candidate ID FEC has no record of
        ],
        ("cm", 2024): [_cm("C1", "C", "LOCKHEED MARTIN CORPORATION")],
        ("cn", 2024): [],
        ("cn", 2020): [_cn("S1", "SMITH, JANE")],    # last ran in 2020: found by reaching back
        ("pas2", 2024): [_pas2("C1", "24K", "S1", 1000)],  # older cycle: superseded by 2026
    }

    def fake_get(url, timeout):
        name, yy = url.rsplit("/", 1)[1][:-6], int("20" + url[-6:-4])
        resp = MagicMock()
        if (name, yy) not in files:                   # a cycle FEC has not published
            def boom(): raise fec_pac.requests.HTTPError("404")
            resp.raise_for_status = boom
            return resp
        resp.content = _zip(files[(name, yy)]); resp.raise_for_status = lambda: None
        return resp

    with patch.object(fec_pac.requests, "Session") as S:
        S.return_value.get.side_effect = fake_get
        rows = fec_pac.fetch_pac_donations([2026, 2024])
    assert len(rows) == 1
    r = rows[0]
    assert (r["company_name"], r["fec_id"], r["amount"], r["year"]) == ("LOCKHEED MARTIN CORPORATION", "S1", 7500.0, 2026)
    assert r["politician_name"] == "SMITH, JANE" and r["office"] == "Senate"
    assert r["source_url"] == "https://www.fec.gov/data/committee/C1/"


def test_cycles_are_the_current_even_year_and_the_one_before():
    from datetime import datetime
    assert fec_pac.current_cycles(datetime(2027, 3, 1)) == [2028, 2026]
    assert fec_pac.current_cycles(datetime(2026, 9, 28)) == [2026, 2024]
