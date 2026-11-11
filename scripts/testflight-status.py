#!/usr/bin/env python3
"""Print the TestFlight state of the iOS app: recent builds, beta review, public link.

  python3 scripts/testflight-status.py
  python3 scripts/testflight-status.py --release 7 "What to test text"

--release waits for the uploaded build to finish processing, sets its
"What to Test" note, adds it to the public-link group and submits it for
beta review (external testers only get it once Apple approves).

Needs ASC_KEY_ID and ASC_ISSUER_ID in .env, the matching key at
~/.appstoreconnect/private_keys/AuthKey_<ASC_KEY_ID>.p8, and `pip install pyjwt cryptography`.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request

import jwt

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = "6807816209"
PUBLIC_GROUP = "6c345382-878d-4c81-b6ef-b3da65776306"  # "Beta Testers", the public-link group


def env_value(key):
    for line in open(os.path.join(ROOT, ".env")):
        if line.startswith(key + "="):
            return line.split("=", 1)[1].strip().strip("\"'")


KEY_ID, ISSUER = env_value("ASC_KEY_ID"), env_value("ASC_ISSUER_ID")
KEY = open(os.path.expanduser(f"~/.appstoreconnect/private_keys/AuthKey_{KEY_ID}.p8")).read()
now = int(time.time())
TOKEN = jwt.encode({"iss": ISSUER, "iat": now, "exp": now + 600, "aud": "appstoreconnect-v1"},
                   KEY, algorithm="ES256", headers={"kid": KEY_ID})


def get(path):
    req = urllib.request.Request("https://api.appstoreconnect.apple.com" + path,
                                 headers={"Authorization": "Bearer " + TOKEN})
    try:
        return json.load(urllib.request.urlopen(req))
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return {"data": None}
        raise


def send(method, path, body):
    # A build that just finished processing can still 404 for a few minutes.
    for attempt in range(6):
        req = urllib.request.Request("https://api.appstoreconnect.apple.com" + path, method=method,
                                     data=json.dumps(body).encode(),
                                     headers={"Authorization": "Bearer " + TOKEN,
                                              "Content-Type": "application/json"})
        try:
            raw = urllib.request.urlopen(req).read()
            return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as e:
            detail = e.read().decode()[:500]
            if e.code != 404 or attempt == 5:
                sys.exit(f"{method} {path} failed: {e.code} {detail}")
            time.sleep(60)


def release(version, whats_new):
    for _ in range(40):                      # processing usually takes 5-15 minutes
        found = get(f"/v1/builds?filter[app]={APP}&filter[version]={version}")["data"]
        if found and found[0]["attributes"]["processingState"] == "VALID":
            break
        print(f"build {version}: {found[0]['attributes']['processingState'] if found else 'not visible yet'}")
        time.sleep(60)
    else:
        sys.exit(f"build {version} did not finish processing")
    build = found[0]["id"]

    locs = get(f"/v1/builds/{build}/betaBuildLocalizations")["data"]
    if locs:
        send("PATCH", f"/v1/betaBuildLocalizations/{locs[0]['id']}",
             {"data": {"type": "betaBuildLocalizations", "id": locs[0]["id"],
                       "attributes": {"whatsNew": whats_new}}})
    else:
        send("POST", "/v1/betaBuildLocalizations",
             {"data": {"type": "betaBuildLocalizations",
                       "attributes": {"locale": "en-US", "whatsNew": whats_new},
                       "relationships": {"build": {"data": {"type": "builds", "id": build}}}}})
    # From the build's side: the group's /relationships/builds endpoint can 404
    # on a freshly processed build long after this one accepts it.
    send("POST", f"/v1/builds/{build}/relationships/betaGroups",
         {"data": [{"type": "betaGroups", "id": PUBLIC_GROUP}]})
    send("POST", "/v1/betaAppReviewSubmissions",
         {"data": {"type": "betaAppReviewSubmissions",
                   "relationships": {"build": {"data": {"type": "builds", "id": build}}}}})
    print(f"build {version}: added to the public group and submitted for beta review")


if len(sys.argv) > 1 and sys.argv[1] == "--release":
    release(sys.argv[2], sys.argv[3])

for b in get(f"/v1/builds?filter[app]={APP}&sort=-uploadedDate&limit=3")["data"]:
    a = b["attributes"]
    review = (get(f"/v1/builds/{b['id']}/betaAppReviewSubmission")["data"] or {}).get("attributes", {})
    detail = get(f"/v1/builds/{b['id']}/buildBetaDetail")["data"]["attributes"]
    print(f"build {a['version']}: {a['processingState']}{' EXPIRED' if a['expired'] else ''}, "
          f"expires {a.get('expirationDate', '?')[:10]}, external {detail['externalBuildState']}, "
          f"beta review {review.get('betaReviewState', 'not submitted')}")

g = get(f"/v1/betaGroups/{PUBLIC_GROUP}")["data"]["attributes"]
builds = [x["attributes"]["version"] for x in get(f"/v1/betaGroups/{PUBLIC_GROUP}/builds")["data"]]
testers = get(f"/v1/betaGroups/{PUBLIC_GROUP}/betaTesters?limit=200")["data"]
print(f"public link: {'ON' if g['publicLinkEnabled'] else 'OFF'} {g.get('publicLink')} "
      f"(limit {g.get('publicLinkLimit') if g.get('publicLinkLimitEnabled') else 'none'})")
print(f"builds in group: {', '.join(builds)}; testers joined: {len(testers)}")
