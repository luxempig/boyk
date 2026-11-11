#!/usr/bin/env python3
"""
Put the Boyk backend to sleep, or wake it up.

The project runs two paid stacks that bill continuously even when nobody is
using them: Neo4j AuraDB (startup-program credits) and AWS (App Runner +
scheduled ETL). This script drives both from one command so hibernating between
work sessions is a 30-second chore instead of a console safari.

    python3 scripts/hibernate.py status
    python3 scripts/hibernate.py sleep
    python3 scripts/hibernate.py wake

IMPORTANT — pausing Aura is not free and does not last:
  * A paused instance still bills at roughly 20% of the running rate.
  * Paid tiers AUTO-RESUME after 30 days. Re-run `sleep` about every 4 weeks,
    or the instances quietly return to full price.
Run `status` to see the auto-resume deadline.

Credentials come from two different places, which is easy to get wrong:
  * Aura *lifecycle* (pause/resume) -> NEO4J_AURA_CLIENT_ID / _SECRET in
    .mcp.json. These are Management API OAuth creds, NOT the bolt password.
  * AWS -> BOYK_AWS_ACCESS_KEY / BOYK_SECRET_TOKEN in .env. The default
    ~/.aws/credentials points at a decommissioned account, so it is bypassed.
"""

import base64
import json
import os
import subprocess
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
AURA_INSTANCES = {"362d2469": "Prod", "d74b1f99": "Staging"}
ETL_RULES = ["boyk-etl-daily", "boyk-etl-staging-weekly"]
REGION = "us-east-1"

# Aura auto-resumes paid tiers after this long, so a pause has a shelf life.
PAUSE_SHELF_LIFE = timedelta(days=30)


# --------------------------------------------------------------------------
# credentials
# --------------------------------------------------------------------------

def aura_token() -> str:
    """Exchange the Management API client credentials for a bearer token."""
    cfg = json.loads((ROOT / ".mcp.json").read_text())
    env = cfg["mcpServers"]["neo4j-aura"]["env"]
    basic = base64.b64encode(
        f"{env['NEO4J_AURA_CLIENT_ID']}:{env['NEO4J_AURA_CLIENT_SECRET']}".encode()
    ).decode()
    req = urllib.request.Request(
        "https://api.neo4j.io/oauth/token",
        data=urllib.parse.urlencode({"grant_type": "client_credentials"}).encode(),
        headers={
            "Authorization": f"Basic {basic}",
            "Content-Type": "application/x-www-form-urlencoded",
        },
    )
    return json.load(urllib.request.urlopen(req))["access_token"]


def aws_env() -> dict:
    """
    .env holds unquoted values containing special characters, so it cannot be
    `source`d — each key is parsed out individually instead.
    """
    creds = {}
    for line in (ROOT / ".env").read_text().splitlines():
        if "=" not in line or line.lstrip().startswith("#"):
            continue
        key, _, value = line.partition("=")
        creds[key.strip()] = value.strip()

    missing = [k for k in ("BOYK_AWS_ACCESS_KEY", "BOYK_SECRET_TOKEN") if k not in creds]
    if missing:
        sys.exit(f"error: {', '.join(missing)} not found in .env")

    return {
        **os.environ,
        "AWS_ACCESS_KEY_ID": creds["BOYK_AWS_ACCESS_KEY"],
        "AWS_SECRET_ACCESS_KEY": creds["BOYK_SECRET_TOKEN"],
        "AWS_DEFAULT_REGION": REGION,
    }


def aws(*args: str) -> str:
    result = subprocess.run(
        ["aws", *args], env=aws_env(), capture_output=True, text=True
    )
    if result.returncode != 0:
        return f"ERROR: {result.stderr.strip().splitlines()[-1] if result.stderr.strip() else 'unknown'}"
    return result.stdout.strip()


# --------------------------------------------------------------------------
# Aura
# --------------------------------------------------------------------------

def aura_call(instance_id: str, action: str, token: str) -> str:
    req = urllib.request.Request(
        f"https://api.neo4j.io/v1/instances/{instance_id}/{action}",
        data=b"",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        return json.load(urllib.request.urlopen(req))["data"].get("status", "?")
    except urllib.error.HTTPError as exc:
        # 400 usually just means "already in that state" — not worth aborting on.
        return f"HTTP {exc.code}: {exc.read().decode()[:120]}"


def aura_status(instance_id: str, token: str) -> dict:
    req = urllib.request.Request(
        f"https://api.neo4j.io/v1/instances/{instance_id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    return json.load(urllib.request.urlopen(req))["data"]


# --------------------------------------------------------------------------
# commands
# --------------------------------------------------------------------------

def cmd_status() -> None:
    token = aura_token()
    print("Neo4j AuraDB")
    any_paused = False
    for iid, name in AURA_INSTANCES.items():
        data = aura_status(iid, token)
        status = data.get("status", "?")
        any_paused = any_paused or status == "paused"
        print(f"  {name:<9} {iid}  {status:<10} {data.get('memory','')} {data.get('type','')}")

    if any_paused:
        print(
            f"\n  NOTE: paused instances still bill at ~20%, and paid tiers auto-resume\n"
            f"  after 30 days. Re-run `sleep` before then to stay paused."
        )

    print("\nAWS App Runner")
    services = aws(
        "apprunner", "list-services",
        "--output", "text",
        "--query", "ServiceSummaryList[].[ServiceName,Status]",
    )
    for line in services.splitlines():
        print(f"  {line}")

    print("\nAWS EventBridge (scheduled ETL)")
    for rule in ETL_RULES:
        state = aws(
            "events", "describe-rule", "--name", rule,
            "--output", "text", "--query", "State",
        )
        print(f"  {rule:<26} {state}")


def cmd_sleep() -> None:
    print("Disabling scheduled ETL...")
    for rule in ETL_RULES:
        aws("events", "disable-rule", "--name", rule)
        print(f"  disabled  {rule}")

    print("\nPausing App Runner...")
    for line in aws(
        "apprunner", "list-services",
        "--output", "text",
        "--query", "ServiceSummaryList[].[ServiceName,ServiceArn]",
    ).splitlines():
        name, arn = line.split("\t")
        aws("apprunner", "pause-service", "--service-arn", arn)
        print(f"  pausing   {name}")

    # Aura goes last: the API and ETL should stop talking to it before it
    # disappears, otherwise they spend their final minutes throwing errors.
    print("\nPausing AuraDB...")
    token = aura_token()
    for iid, name in AURA_INSTANCES.items():
        print(f"  {name:<9} -> {aura_call(iid, 'pause', token)}")

    deadline = (datetime.now(timezone.utc) + PAUSE_SHELF_LIFE).date()
    print(f"\nAsleep. Re-run `sleep` before {deadline} or Aura auto-resumes at full rate.")


def cmd_wake() -> None:
    # Aura first, so the API has a live database the moment it accepts traffic.
    print("Resuming AuraDB (takes a few minutes)...")
    token = aura_token()
    for iid, name in AURA_INSTANCES.items():
        print(f"  {name:<9} -> {aura_call(iid, 'resume', token)}")

    print("\nResuming App Runner...")
    for line in aws(
        "apprunner", "list-services",
        "--output", "text",
        "--query", "ServiceSummaryList[].[ServiceName,ServiceArn]",
    ).splitlines():
        name, arn = line.split("\t")
        aws("apprunner", "resume-service", "--service-arn", arn)
        print(f"  resuming  {name}")

    print("\nRe-enabling scheduled ETL...")
    for rule in ETL_RULES:
        aws("events", "enable-rule", "--name", rule)
        print(f"  enabled   {rule}")

    print("\nWaking. Run `status` in a few minutes to confirm everything is up.")


COMMANDS = {"status": cmd_status, "sleep": cmd_sleep, "wake": cmd_wake}

if __name__ == "__main__":
    action = sys.argv[1] if len(sys.argv) > 1 else "status"
    if action not in COMMANDS:
        sys.exit(f"usage: {sys.argv[0]} {{{'|'.join(COMMANDS)}}}")
    COMMANDS[action]()
