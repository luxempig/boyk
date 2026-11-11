#!/usr/bin/env python3
"""Curate the recorded sample content in public/demo-data/social.json.

  python3 scripts/demo/curate-social.py

Run after snapshot-social.mjs. The seeded sample boycotts were written before
most of them had companies attached, so the recording alone shows mostly empty
lists. This:

  * drops the sample boycotts named in DROP, with their posts and comments;
  * attaches well-known companies to the boycotts in ATTACH, chosen so that the
    boycott's own description already defines who belongs ("top weapons
    manufacturers"), so the demo shows a boycott covering real ownership trees;
  * lists boycotts that have companies first.

Company ids are the graph's (LEI and Wikidata id), so every link opens a real
company page in the snapshot.
"""
import json, os, uuid

PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "public", "demo-data", "social.json")

DROP = {"BDS - Tech Complicity"}

ATTACH = {
    "Defense Profiteers": [
        ("Lockheed Martin", "DPRBOZP0K5RM2YE8UU08", "Q7240"),
        ("RTX", "I07WOS4YJ0N7YRFE7309", "Q89368734"),
        ("General Dynamics", "9C1X8XOOTYY2FNYTVH06", "Q502940"),
        ("Northrop Grumman Corporation", "RIMU48P07456QXSO0R61", "Q329953"),
        ("Boeing", "RVHJWBXLJ1RFUBSY1F30", "Q66"),
    ],
    "Insulin Price Gougers": [
        ("Eli Lilly and Company", "549300VB1EUTLVEO8566", "Q632240"),
        ("Sanofi", "549300E9PC51EN656011", "Q158205"),
    ],
}

doc = json.load(open(PATH))
rpc = doc["rpc"]
boycotts = rpc["get_public_boycotts|"]
dropped = {b["id"] for b in boycotts if b["name"] in DROP}


def stable_id(*parts):
    return str(uuid.uuid5(uuid.NAMESPACE_URL, "boyk-demo/" + "/".join(parts)))


links = {}
for b in boycotts:
    for name, lei, qid in ATTACH.get(b["name"], []):
        company_id = stable_id("company", lei)
        links.setdefault(b["id"], []).append({
            "id": stable_id("link", b["id"], lei),
            "added_at": b["created_at"],
            "company_id": company_id,
            "companies": {"id": company_id, "lei": lei, "name": name, "website": None,
                          "logo_url": None, "description": None, "wikidata_qid": qid},
            "block_owns": True, "block_brands": True, "block_owned_by": False,
            "block_customers": False, "block_suppliers": False,
        })


def touches_dropped(v):
    return isinstance(v, dict) and (
        v.get("id") in dropped or v.get("boycott_id") in dropped
        or (isinstance(v.get("boycott"), dict) and v["boycott"].get("id") in dropped)
    )


def walk(v):
    if isinstance(v, list):
        return [walk(x) for x in v if not touches_dropped(x)]
    if isinstance(v, dict):
        v = {k: walk(x) for k, x in v.items()}
        if v.get("id") in links and "boycott_companies" in v:
            have = {c["companies"]["lei"] for c in v["boycott_companies"]}
            v["boycott_companies"] += [c for c in links[v["id"]] if c["companies"]["lei"] not in have]
        return v
    return v


rpc = {k: walk(v) for k, v in rpc.items() if k.split("|")[-1] not in dropped}
# get_post returns one post, not a list: remove recorded posts about a dropped boycott.
rpc = {k: v for k, v in rpc.items()
       if not (k.startswith("get_post|") and any(touches_dropped(x) for x in (v if isinstance(v, list) else [v])))}
kept_posts = {p["id"] for p in rpc["feed"]}
rpc = {k: v for k, v in rpc.items() if not k.startswith(("get_post|", "get_post_replies|")) or k.split("|")[1] in kept_posts}

rpc["get_public_boycotts|"].sort(key=lambda b: -len(b.get("boycott_companies") or []))

# A company page lists the boycotts that include it.
for key in [k for k in rpc if k.startswith("get_boycotts_for_company|")]:
    rpc[key] = [b for b in rpc[key] if b.get("id") not in dropped]
    if not rpc[key]:
        del rpc[key]
for b in rpc["get_public_boycotts|"]:
    summary = {k: b[k] for k in ("id", "name", "description", "is_public", "created_at", "creator_id", "tracker_count")}
    for link in b["boycott_companies"]:
        c = link["companies"]
        for cid in (c.get("lei"), c.get("wikidata_qid")):
            if cid:
                rows = rpc.setdefault(f"get_boycotts_for_company|{cid}", [])
                if all(r["id"] != b["id"] for r in rows):
                    rows.append(summary)

doc["rpc"] = rpc
json.dump(doc, open(PATH, "w"), ensure_ascii=False, separators=(",", ":"))
print([(b["name"], len(b["boycott_companies"])) for b in rpc["get_public_boycotts|"]][:4],
      f"{len(rpc['feed'])} posts, {len(rpc)} entries")
