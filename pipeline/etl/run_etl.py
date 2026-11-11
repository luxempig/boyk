#!/usr/bin/env python3
"""
Boyk ETL Pipeline — run_etl.py
Orchestrates all enrichment stages.

Usage:
    python run_etl.py --run                     # Run all stages
    python run_etl.py --run --stages 1,2,7,11   # Run specific stages
    python run_etl.py --run --force              # Skip checkpoint (re-run completed stages)
    python run_etl.py --run --force-keys         # Attempt stages with missing API keys
    python run_etl.py --run --resume             # Resume interrupted stages from progress
    python run_etl.py --check                   # Check which stages can run
    python run_etl.py --status                  # Show checkpoint status of all stages
    python run_etl.py --stats                   # Show database stats
    python run_etl.py --clear                   # Clear database (with confirmation)
"""

import argparse
import atexit
import gc
import json
import logging
import os
import signal
import sys
import time
from typing import Dict, List, Optional, Set, Tuple

from config import (
    Config, check_stage_keys, check_all_stages,
    STAGE_NAMES, STAGE_LIMITS, STAGE_DEPENDENCIES, RETIRED_STAGES,
)
from wikidata_client import WikidataClient
from gleif_client import GleifClient
from neo4j_writer import Neo4jWriter
from company_resolver import CompanyResolver
from models import now_iso

# Enrichment modules
from enrichment import halt_requests, reset_circuit_breakers
from enrichment import openfoodfacts
from enrichment import wikidata_product_ids
from enrichment import logo_dev
from enrichment import sec_edgar
from enrichment import fec_pac
from enrichment import followthemoney
from enrichment import violation_tracker
from enrichment import wikirate
from enrichment import open_supply_hub
from enrichment import wikidata_extended
from enrichment import sec_proxy
from enrichment import epa_echo
from enrichment import subsidy_tracker
from enrichment import osha_violations
from enrichment import usaspending
from enrichment import cfpb_complaints
from enrichment import fda_recalls
from enrichment import cpsc_recalls
from enrichment import icij_offshore
from enrichment import uk_companies_house
from enrichment import ofac_sanctions
from enrichment import aggregate_scores

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)

# The driver logs every "constraint already exists" notification at INFO, one
# multi-line record per statement. Schema setup alone buries the run in ~30 of
# them, which is how genuine warnings went unread for months. Warnings and
# errors from the driver still come through.
logging.getLogger("neo4j.notifications").setLevel(logging.WARNING)

logger = logging.getLogger("etl")

# ── Per-Stage Locking ─────────────────────────────────────────
# Each stage gets its own lock file so independent stages can run concurrently.
# Stages 1 and 2 (core entities) share a lock to prevent overlap.

LOCK_DIR = os.environ.get("ETL_LOCK_DIR", "/tmp")


def _is_pid_alive(pid: int) -> bool:
    """Check if a process with the given PID is still running."""
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        # Process exists but we don't have permission to signal it
        return True


def _lock_path(stage_num: int) -> str:
    """Return the lock file path for a stage."""
    # Stages 1 and 2 share a lock (they write to the same base tables)
    group = "core" if stage_num in (1, 2) else str(stage_num)
    return os.path.join(LOCK_DIR, f"boyk_etl_stage_{group}.lock")


def acquire_stage_lock(stage_num: int, force: bool = False) -> bool:
    """Acquire a per-stage PID lock. Returns True if acquired, False if another process holds it."""
    lock_file = _lock_path(stage_num)
    if os.path.exists(lock_file):
        try:
            with open(lock_file, "r") as f:
                data = json.load(f)
                existing_pid = data.get("pid", 0)
                locked_stage = data.get("stage", stage_num)
        except (ValueError, OSError, json.JSONDecodeError) as e:
            logger.warning(f"Corrupt lock file at {lock_file} ({e}), overwriting")
            existing_pid = None

        if existing_pid is not None and _is_pid_alive(existing_pid):
            if force:
                logger.warning(
                    f"Force overriding lock for stage {stage_num} (PID {existing_pid})"
                )
            else:
                name = STAGE_NAMES.get(locked_stage, f"Stage {locked_stage}")
                logger.error(
                    f"Stage {stage_num} is locked by PID {existing_pid} (running {name}). "
                    f"Lock file: {lock_file}"
                )
                return False
        else:
            if existing_pid is not None:
                logger.warning(
                    f"Stale lock for stage {stage_num} (PID {existing_pid} dead). Overwriting."
                )

    try:
        with open(lock_file, "w") as f:
            json.dump({"pid": os.getpid(), "stage": stage_num, "started": now_iso()}, f)
    except OSError as e:
        logger.error(f"Failed to create stage lock {lock_file}: {e}")
        return False
    return True


def release_stage_lock(stage_num: int) -> None:
    """Release a per-stage lock if it belongs to this process."""
    lock_file = _lock_path(stage_num)
    if not os.path.exists(lock_file):
        return
    try:
        with open(lock_file, "r") as f:
            data = json.load(f)
        if data.get("pid") == os.getpid():
            os.remove(lock_file)
    except (ValueError, OSError, json.JSONDecodeError):
        pass


# ── Legacy Global Lock (backward compat) ─────────────────────

LOCK_FILE = os.environ.get("ETL_LOCK_FILE", "/tmp/boyk_etl.lock")


def acquire_lock() -> None:
    """Acquire a global PID-based lock file, or exit if another ETL run is active."""
    if os.path.exists(LOCK_FILE):
        try:
            with open(LOCK_FILE, "r") as f:
                existing_pid = int(f.read().strip())
        except (ValueError, OSError) as e:
            logger.warning(f"Corrupt lock file at {LOCK_FILE} ({e}), overwriting")
            existing_pid = None

        if existing_pid is not None and _is_pid_alive(existing_pid):
            logger.error(
                f"Another ETL pipeline is already running (PID {existing_pid}). "
                f"Lock file: {LOCK_FILE}"
            )
            logger.error(
                "If this is a stale lock from a killed process, remove the lock file manually:\n"
                f"    rm {LOCK_FILE}"
            )
            sys.exit(1)
        else:
            if existing_pid is not None:
                logger.warning(
                    f"Stale lock file found (PID {existing_pid} is no longer running). "
                    f"Removing stale lock and proceeding."
                )

    # Write current PID to lock file
    current_pid = os.getpid()
    try:
        with open(LOCK_FILE, "w") as f:
            f.write(str(current_pid))
        logger.info(f"ETL lock acquired (PID {current_pid}, lock file: {LOCK_FILE})")
    except OSError as e:
        logger.error(f"Failed to create lock file {LOCK_FILE}: {e}")
        sys.exit(1)

    # Register atexit handler as a safety net for cleanup
    atexit.register(release_lock)


def release_lock() -> None:
    """Release the lock file if it belongs to this process."""
    if not os.path.exists(LOCK_FILE):
        return
    try:
        with open(LOCK_FILE, "r") as f:
            lock_pid = int(f.read().strip())
        if lock_pid == os.getpid():
            os.remove(LOCK_FILE)
            logger.info(f"ETL lock released (PID {lock_pid})")
    except (ValueError, OSError):
        # Lock file is corrupt or already removed — nothing to do
        pass


# ── Progress Tracking ─────────────────────────────────────────
# Tracks which items have been processed within a stage, enabling
# resume on interruption without re-processing completed items.

import threading

class ProgressTracker:
    """Tracks per-stage progress for resumable processing."""

    def __init__(self, checkpoint_dir: str):
        self._progress_dir = os.path.join(checkpoint_dir, "progress")
        os.makedirs(self._progress_dir, exist_ok=True)
        self._stages = {} # stage_num -> {"processed": set(), "total": int, "dirty": bool}
        self._lock = threading.Lock()

    def _progress_file(self, stage_num: int) -> str:
        return os.path.join(self._progress_dir, f"stage_{stage_num}_progress.json")

    def start_stage(self, stage_num: int, total_items: int, resume: bool = False) -> Set[str]:
        """Start tracking a stage. If resume=True, load existing progress.
        Returns set of already-processed item keys to skip."""
        with self._lock:
            self._stages[stage_num] = {"processed": set(), "total": total_items, "dirty": False}

            if resume:
                pf = self._progress_file(stage_num)
                if os.path.exists(pf):
                    try:
                        with open(pf, "r") as f:
                            data = json.load(f)
                        processed = set(data.get("processed_keys", []))
                        self._stages[stage_num]["processed"] = processed
                        logger.info(
                            f"Stage {stage_num}: resuming — {len(processed)}/{total_items} "
                            f"already processed, {total_items - len(processed)} remaining"
                        )
                        return processed
                    except Exception as e:
                        logger.warning(f"Could not load progress for stage {stage_num}: {e}")

            return set()

    def mark_processed(self, stage_num: int, key: str) -> None:
        """Mark a single item as processed."""
        with self._lock:
            if stage_num in self._stages:
                self._stages[stage_num]["processed"].add(key)
                self._stages[stage_num]["dirty"] = True

    def save(self, stage_num: int = None) -> None:
        """Persist current progress to disk."""
        with self._lock:
            stages_to_save = [stage_num] if stage_num is not None else list(self._stages.keys())
            for s in stages_to_save:
                if s not in self._stages or not self._stages[s]["dirty"]:
                    continue
                data = {
                    "stage": s,
                    "updated_at": now_iso(),
                    "processed_count": len(self._stages[s]["processed"]),
                    "total_items": self._stages[s]["total"],
                    "processed_keys": sorted(self._stages[s]["processed"]),
                }
                pf = self._progress_file(s)
                try:
                    with open(pf, "w") as f:
                        json.dump(data, f)
                    self._stages[s]["dirty"] = False
                except OSError as e:
                    logger.warning(f"Failed to save progress for stage {s}: {e}")

    def clear(self, stage_num: int) -> None:
        """Clear progress file after successful stage completion."""
        with self._lock:
            pf = self._progress_file(stage_num)
            if os.path.exists(pf):
                os.remove(pf)
            if stage_num in self._stages:
                del self._stages[stage_num]

    def has_progress(self, stage_num: int) -> bool:
        """Check if a stage has partial progress saved."""
        pf = self._progress_file(stage_num)
        return os.path.exists(pf)

    def get_progress_info(self, stage_num: int) -> Optional[Dict]:
        """Get progress info for a stage (for --status display)."""
        pf = self._progress_file(stage_num)
        if not os.path.exists(pf):
            return None
        try:
            with open(pf, "r") as f:
                return json.load(f)
        except Exception:
            return None


# Wall-clock a stage typically needs, in seconds. Stages 16 and 19 are measured
# against production; the rest are derived from their STAGE_LIMITS company count
# at the ~1.5 s/company rate those two exhibit. Used only to decide whether a
# stage can start before the Lambda deadline — an estimate being wrong costs a
# deferral, never a truncated write.
STAGE_EST_SECONDS: Dict[int, int] = {
    1: 600, 2: 600, 3: 750, 4: 300,
    5: 60,     # measured: 4 s — it builds hotlink URLs and downloads nothing
    6: 300, 7: 240, 8: 750,   # 7: bulk files, ~35 MB for two cycles
    10: 300, 11: 750, 12: 450, 13: 300,
    14: 400,   # measured: 56 s overnight, 431 s when WDQS is slow
    15: 150,
    16: 400,   # measured: 368 s for 300 companies
    17: 450, 18: 300,
    19: 700,   # measured: 672 s for 500 companies
    20: 400, 21: 750, 22: 750, 23: 300, 24: 450,
    25: 120,   # measured: 62 s — two bulk OFAC files, not a per-company API
    27: 120,
}
DEFAULT_STAGE_EST_SECONDS = 600
# Leave room to finish the in-flight writes, run the provenance audit and close
# the driver after the last stage returns.
DEADLINE_SAFETY_MARGIN_SECONDS = 90
# Once inside a stage, leave at least this much time to unwind, write the summary
# and close the driver before the runtime kills us.
DEADLINE_ABORT_MARGIN_SECONDS = 75


class StageDeadlineExceeded(Exception):
    """Raised inside a stage's per-item loop when the invocation is nearly over.

    Checking the budget only at stage entry is not enough: a stage whose upstream
    is failing retries with backoff and has effectively unbounded duration, so it
    consumes whatever budget remains and the runtime kills the whole invocation
    mid-write. Stage 26 did exactly that against a dead GDELT endpoint, taking
    stages 21, 22 and 27 down with it and burning two Lambda retries per night.
    """


class ETLPipeline:
    def __init__(self, config: Config, force: bool = False,
                 force_keys: bool = False, resume: bool = False,
                 deadline_fn=None):
        self.config = config
        self.force = force
        self.force_keys = force_keys
        self.resume = resume
        # Returns seconds of execution time left, or None when unbounded (CLI).
        self.deadline_fn = deadline_fn
        self._deferred_stages: List[Tuple[int, int, int]] = []
        self._cut_short_stages: List[Tuple[int, str]] = []
        self.writer = Neo4jWriter(config)
        self.wikidata = WikidataClient(config)
        self.gleif = GleifClient(config)
        self._lei_set: Set[str] = set()
        self._company_names: List[str] = []
        self._skipped_stages: List[Tuple[int, List[str]]] = []
        self._failed_stages: List[Tuple[int, str]] = []
        self._completed_stages: List[int] = []
        if os.environ.get("AWS_LAMBDA_FUNCTION_NAME"):
            self._checkpoint_dir = "/tmp/checkpoints"
        else:
            self._checkpoint_dir = os.path.join(os.path.dirname(__file__), "checkpoints")
        os.makedirs(self._checkpoint_dir, exist_ok=True)
        self._progress = ProgressTracker(self._checkpoint_dir)
        self._shutting_down = False
        self._held_locks: List[int] = []
        self._provenance_audit_result: Optional[Dict] = None
        self._provenance_audit_failure: Optional[str] = None
        import threading
        self._state_lock = threading.Lock()

        # Install graceful shutdown handler
        signal.signal(signal.SIGINT, self._handle_shutdown)
        signal.signal(signal.SIGTERM, self._handle_shutdown)

    def _handle_shutdown(self, signum, frame):
        """Save progress on SIGINT/SIGTERM so stage can be resumed."""
        if self._shutting_down:
            logger.warning("Forced exit")
            sys.exit(1)
        self._shutting_down = True
        sig_name = "SIGINT" if signum == signal.SIGINT else "SIGTERM"
        logger.warning(f"\n{sig_name} received — saving progress and shutting down...")
        self._progress.save()
        with self._state_lock:
            locks = list(self._held_locks)
        for stage_num in locks:
            release_stage_lock(stage_num)
        logger.info("Progress saved. Resume with: python run_etl.py --run --resume --stages <N>")
        sys.exit(0)

    def close(self):
        self.writer.close()
        with self._state_lock:
            locks = list(self._held_locks)
        for stage_num in locks:
            release_stage_lock(stage_num)

    def _get_stage_limit(self, stage_num: int) -> int:
        """Get the company name limit for a stage (0 = no limit)."""
        return STAGE_LIMITS.get(stage_num, 0)

    def _apply_company_shard(self, stage_num: int, names: List[str]) -> List[str]:
        """Select a deterministic shard of the company list if sharding is enabled."""
        shard_count = max(1, int(getattr(self.config, "etl_company_shard_count", 1) or 1))
        shard_index = int(getattr(self.config, "etl_company_shard_index", 0) or 0)
        if shard_count <= 1 or not names:
            return names

        shard_index = shard_index % shard_count
        sharded = [name for idx, name in enumerate(names) if idx % shard_count == shard_index]
        logger.info(
            f"Stage {stage_num}: shard {shard_index + 1}/{shard_count} "
            f"selected {len(sharded)}/{len(names)} companies"
        )
        return sharded

    def _apply_capped_rotation(self, stage_num: int, names: List[str], limit: int) -> List[str]:
        """Apply a deterministic rotating window for capped stages to improve coverage over time."""
        if limit <= 0 or len(names) <= limit:
            return names

        rotate_capped = bool(getattr(self.config, "etl_rotate_capped_stages", True))
        if not rotate_capped:
            return names[:limit]

        day_key = int(time.strftime("%Y%m%d", time.gmtime()))
        offset = ((day_key * 97) + (stage_num * 53)) % len(names)
        window = names[offset:offset + limit]
        if len(window) < limit:
            window.extend(names[: limit - len(window)])

        logger.info(
            f"Stage {stage_num}: rotating capped window (offset={offset}, limit={limit}, total={len(names)})"
        )
        return window

    def _resolver(self) -> CompanyResolver:
        """Company name->identity resolver, built once per run from the graph.

        Enrichment writers use it to resolve company_name to a single node
        identity (lei/wikidata_id) before writing, so name collisions can no
        longer fan an edge out to every same-name company. Built lazily on first
        enrichment use — by then stages 1-2 have populated the companies.
        """
        if getattr(self, "_company_resolver", None) is None:
            self._company_resolver = CompanyResolver(self.writer.get_company_identity_rows())
        return self._company_resolver

    def _limit_names(self, stage_num: int) -> List[str]:
        """Return company names limited per stage config, filtered by resume progress."""
        limit = self._get_stage_limit(stage_num)
        names = list(self._company_names)
        names = self._apply_company_shard(stage_num, names)
        names = self._apply_capped_rotation(stage_num, names, limit)

        # If resuming, filter out already-processed names
        if self.resume:
            already_done = self._progress.start_stage(stage_num, len(names), resume=True)
            if already_done:
                names = [n for n in names if n not in already_done]
        else:
            self._progress.start_stage(stage_num, len(names), resume=False)

        return names

    def _save_progress_periodic(self, stage_num: int, name: str, counter: int, interval: int = 50):
        """Mark a name as processed, save periodically, and enforce the deadline.

        Every enrichment stage calls this once per company, which makes it the one
        place a time check reaches all of them without touching each module.
        """
        self._progress.mark_processed(stage_num, name)
        if counter % interval == 0:
            self._progress.save(stage_num)

        remaining = self._seconds_remaining()
        if remaining is not None and remaining < DEADLINE_ABORT_MARGIN_SECONDS:
            # Fold every outstanding request first. Concurrent stages have the
            # rest of the company list already queued, and the pool waits for all
            # of it on the way out; without this the drain outlives the deadline
            # and the exception below never gets the chance to be reported.
            halt_requests()
            self._progress.save(stage_num)
            raise StageDeadlineExceeded(
                f"stopped after {counter} items with {remaining:.0f}s left"
            )

    def _check_checkpoint(self, stage_num: int) -> bool:
        """Check if a stage has a recent checkpoint (completed today)."""
        cp_file = os.path.join(self._checkpoint_dir, f"stage_{stage_num}.json")
        if not os.path.exists(cp_file):
            return False
        try:
            with open(cp_file, "r") as f:
                cp = json.load(f)
            completed_at = cp.get("completed_at", "")
            today = time.strftime("%Y-%m-%d")
            return completed_at.startswith(today)
        except Exception:
            return False

    def _read_checkpoint(self, stage_num: int) -> Optional[Dict]:
        """Read checkpoint data for a stage (for --status display)."""
        cp_file = os.path.join(self._checkpoint_dir, f"stage_{stage_num}.json")
        if not os.path.exists(cp_file):
            return None
        try:
            with open(cp_file, "r") as f:
                return json.load(f)
        except Exception:
            return None

    def _write_checkpoint(self, stage_num: int, records_written: int,
                         companies_processed: int, duration: float):
        """Write a checkpoint file after stage completion."""
        cp = {
            "stage": stage_num,
            "completed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "records_written": records_written,
            "companies_processed": companies_processed,
            "duration_seconds": round(duration, 1),
        }
        cp_file = os.path.join(self._checkpoint_dir, f"stage_{stage_num}.json")
        with open(cp_file, "w") as f:
            json.dump(cp, f, indent=2)
        logger.debug(f"Checkpoint written for stage {stage_num}")

    def _check_dependencies(self, stage_num: int) -> bool:
        """Check if all dependency stages have been completed (this run or any checkpoint)."""
        deps = STAGE_DEPENDENCIES.get(stage_num, [])
        if not deps:
            return True
        for dep in deps:
            with self._state_lock:
                completed = dep in self._completed_stages
            if not completed and not self._has_any_checkpoint(dep):
                logger.warning(
                    f"Stage {stage_num}: dependency stage {dep} not completed, skipping"
                )
                return False
        return True

    def _has_any_checkpoint(self, stage_num: int) -> bool:
        """Check if a stage has ANY checkpoint (not just today's). For dependency checks."""
        cp_file = os.path.join(self._checkpoint_dir, f"stage_{stage_num}.json")
        return os.path.exists(cp_file)

    def run(self, stages: List[int] = None):
        """Run the full ETL pipeline or a subset of stages."""
        if stages is None:
            stages = self.config.all_stages

        total_start = time.time()
        logger.info(f"Starting ETL pipeline — stages: {stages}")
        if self.resume:
            logger.info("Resume mode: will continue interrupted stages from saved progress")

        # Pre-flight: check all requested stages for missing keys
        stage_readiness = check_all_stages()
        runnable_stages = []
        for s in stages:
            if s in RETIRED_STAGES:
                self._skipped_stages.append((s, ["retired"]))
                logger.warning(f"SKIPPING stage {s} ({STAGE_NAMES.get(s, s)}): retired — {RETIRED_STAGES[s]}")
                continue
            can_run, missing = check_stage_keys(s)
            if can_run or self.force_keys:
                runnable_stages.append(s)
                if not can_run and self.force_keys:
                    logger.warning(f"Stage {s}: missing {missing} but --force-keys is set, will attempt anyway")
            else:
                self._skipped_stages.append((s, missing))
                name = STAGE_NAMES.get(s, f"Stage {s}")
                logger.warning(f"SKIPPING stage {s} ({name}): missing env vars {missing}")

        if not runnable_stages:
            logger.error("No stages can run! Check your .env file.")
            self._print_summary(time.time() - total_start)
            return

        logger.info(f"Will run {len(runnable_stages)}/{len(stages)} stages: {runnable_stages}")

        # Pre-flight: verify Neo4j connection
        if not self.writer.health_check():
            logger.error("Neo4j health check failed — aborting pipeline")
            self._print_summary(time.time() - total_start)
            return

        # Schema setup
        self.writer.setup_constraints_and_indexes()
        time.sleep(1)

        # Core entity stages must run first
        if 1 in runnable_stages:
            self._run_stage(1, self._stage_1_wikidata)
        if 2 in runnable_stages:
            self._run_stage(2, self._stage_2_gleif)

        # Retract stale ownership rels after sources refresh
        if 1 in runnable_stages or 2 in runnable_stages:
            self._retract_stale_ownership()

        gc.collect()

        # Load company names for enrichment stages
        self._company_names = self.writer.get_all_company_names()
        logger.info(f"Loaded {len(self._company_names)} company names for enrichment")

        if not self._company_names and any(s > 2 for s in runnable_stages):
            logger.warning("No company names loaded — enrichment stages will have no input.")
            logger.warning("Make sure stages 1 and 2 ran successfully first.")

        # Enrichment stages (ordered to maximize downstream selector coverage)
        stage_map = {
            3: self._stage_3_openfoodfacts,
            4: self._stage_4_wikidata_products,
            5: self._stage_5_logos,
            6: self._stage_6_sec_edgar,
            7: self._stage_7_fec,
            8: self._stage_8_sec_13f,
            10: self._stage_10_followthemoney,
            11: self._stage_11_violations,
            12: self._stage_12_wikirate,
            13: self._stage_13_open_supply_hub,
            14: self._stage_14_wikidata_extended,
            15: self._stage_15_sec_proxy,
            16: self._stage_16_epa_echo,
            17: self._stage_17_subsidies,
            18: self._stage_18_osha,
            19: self._stage_19_usaspending,
            20: self._stage_20_cfpb,
            21: self._stage_21_fda_recalls,
            22: self._stage_22_cpsc_recalls,
            23: self._stage_23_icij_offshore,
            24: self._stage_24_uk_companies_house,
            25: self._stage_25_ofac,
            27: self._stage_27_aggregates,
        }

        import concurrent.futures

        enrichment_stages = [s for s in runnable_stages if s not in (1, 2, 27) and s in stage_map]

        # Stage 14 populates website/CIK fields used by stages 5, 6, and 15.
        # Run it before the rest so downstream stages see the fullest company profile set.
        pre_enrichment_stages = [s for s in (14,) if s in enrichment_stages]
        for s in pre_enrichment_stages:
            self._run_stage(s, stage_map[s])
        if pre_enrichment_stages:
            gc.collect()

        enrichment_stages = [s for s in enrichment_stages if s not in pre_enrichment_stages]

        stage_concurrency = max(1, int(getattr(self.config, "etl_stage_concurrency", 1) or 1))

        if enrichment_stages:
            if stage_concurrency <= 1:
                order = self._rotate_stage_order(sorted(enrichment_stages))
                logger.info(
                    f"Running {len(order)} enrichment stages sequentially in order {order}"
                )
                for s in order:
                    if self._shutting_down:
                        break
                    self._run_stage(s, stage_map[s])
                    gc.collect()
            else:
                logger.info(
                    f"Running {len(enrichment_stages)} enrichment stages concurrently "
                    f"with {min(stage_concurrency, len(enrichment_stages))} workers"
                )
                with concurrent.futures.ThreadPoolExecutor(
                    max_workers=min(stage_concurrency, len(enrichment_stages))
                ) as executor:
                    futures = {
                        executor.submit(self._run_stage, s, stage_map[s]): s
                        for s in enrichment_stages
                    }
                    for future in concurrent.futures.as_completed(futures):
                        s = futures[future]
                        try:
                            future.result()
                        except Exception as e:
                            logger.error(f"Stage {s} failed in executor: {e}")
                gc.collect()

        # Run stage 27 last if requested
        if 27 in runnable_stages and 27 in stage_map:
            self._run_stage(27, stage_map[27])
            gc.collect()

        # Optional relationship provenance backfill + audit (edge-level evidence/source coverage).
        if getattr(self.config, "etl_backfill_relationship_provenance", False):
            try:
                self.writer.backfill_relationship_provenance()
            except Exception as e:
                logger.warning(f"Relationship provenance backfill failed: {e}")

        if getattr(self.config, "etl_audit_relationship_provenance", True):
            try:
                self._provenance_audit_result = self.writer.audit_relationship_provenance(
                    sample_limit=int(getattr(self.config, "etl_provenance_audit_sample_limit", 20) or 20)
                )
                if not self._provenance_audit_result.get("ok", False):
                    totals = self._provenance_audit_result.get("totals", {})
                    self._provenance_audit_failure = (
                        "Relationship provenance audit failed "
                        f"(missing_source={totals.get('missing_source', 0)}, "
                        f"missing_last_confirmed={totals.get('missing_last_confirmed', 0)}, "
                        f"missing_evidence={totals.get('missing_evidence', 0)})"
                    )
                    if getattr(self.config, "etl_fail_on_missing_relationship_provenance", False):
                        logger.error(self._provenance_audit_failure)
                    else:
                        logger.warning(self._provenance_audit_failure)
            except Exception as e:
                logger.warning(f"Relationship provenance audit failed to run: {e}")

        elapsed = time.time() - total_start
        self._print_summary(elapsed)
        if self._provenance_audit_failure and getattr(self.config, "etl_fail_on_missing_relationship_provenance", False):
            raise RuntimeError(self._provenance_audit_failure)

    def _rotate_stage_order(self, stages: List[int]) -> List[int]:
        """Rotate which stage runs first, keyed on the day.

        A fixed order plus a deadline means the tail of the list never runs: the
        stages ahead of it consume the budget every single night. Rotating gives
        each stage a turn at the front, so coverage is spread across days rather
        than concentrated on the low-numbered stages.
        """
        if len(stages) < 2 or not getattr(self.config, "etl_rotate_capped_stages", True):
            return stages
        if self.deadline_fn is None:
            return stages  # unbounded CLI runs get everything anyway
        # Days since epoch, not YYYYMMDD: the latter jumps by 70 at a month
        # boundary, so `% len(stages)` skips shifts and starves those positions.
        shift = int(time.time() // 86400) % len(stages)
        return stages[shift:] + stages[:shift]

    def _seconds_remaining(self) -> Optional[float]:
        """Execution time left before the runtime kills us, or None if unbounded."""
        if self.deadline_fn is None:
            return None
        try:
            return float(self.deadline_fn())
        except Exception as e:
            logger.warning(f"Could not read remaining time, treating as unbounded: {e}")
            return None

    def _has_budget_for(self, num: int) -> bool:
        """Whether this stage can plausibly finish before the deadline.

        Stage 19 alone burns 672 s of a 900 s Lambda, so a batch that starts one
        stage too many gets killed mid-write with no summary and no alert — which
        is how the pipeline ran for 112 days without ever completing. Declining to
        start is always better: stages are idempotent and the company window
        rotates, so deferred work is picked up by a later run.
        """
        remaining = self._seconds_remaining()
        if remaining is None:
            return True
        needed = STAGE_EST_SECONDS.get(num, DEFAULT_STAGE_EST_SECONDS) + DEADLINE_SAFETY_MARGIN_SECONDS
        if remaining >= needed:
            return True
        name = STAGE_NAMES.get(num, f"Stage {num}")
        logger.warning(
            f"DEFERRING stage {num} ({name}): needs ~{needed}s but only "
            f"{remaining:.0f}s remain before the deadline"
        )
        with self._state_lock:
            self._deferred_stages.append((num, int(needed), int(remaining)))
        return False

    def _run_stage(self, num: int, func):
        """Run a stage with timing, locking, dependency check, checkpoint, and error handling."""
        name = STAGE_NAMES.get(num, f"Stage {num}")

        if not self._has_budget_for(num):
            return

        # Check dependencies (skipped with --force)
        if not self.force and not self._check_dependencies(num):
            with self._state_lock:
                self._skipped_stages.append((num, [f"dependency not met"]))
            return

        # Check checkpoint (skip if already completed today, unless --force or --resume)
        if not self.force and not self.resume and self._check_checkpoint(num):
            logger.info(f"Stage {num} ({name}): already completed today, skipping (use --force to re-run)")
            with self._state_lock:
                self._completed_stages.append(num)
            return

        # For --resume, only re-run if there's saved progress (i.e., it was interrupted)
        if self.resume and not self.force and self._check_checkpoint(num):
            if not self._progress.has_progress(num):
                logger.info(f"Stage {num} ({name}): completed today with no interrupted progress, skipping")
                with self._state_lock:
                    self._completed_stages.append(num)
                return

        # Acquire per-stage lock (force overrides stale locks)
        if not acquire_stage_lock(num, force=self.force):
            with self._state_lock:
                self._skipped_stages.append((num, ["locked by another process"]))
            return
        with self._state_lock:
            self._held_locks.append(num)

        logger.info(f"{'='*60}")
        logger.info(f"STAGE {num}: {name}")
        logger.info(f"{'='*60}")
        # Breaker state is per-host and process-global; clear it so a host that
        # was dead for the previous stage does not start this one pre-tripped.
        reset_circuit_breakers()
        start = time.time()
        try:
            result = func()
            records = result if isinstance(result, int) else 0
            with self._state_lock:
                self._completed_stages.append(num)
            elapsed = time.time() - start
            self._write_checkpoint(num, records, len(self._company_names), elapsed)
            # Clear progress file on successful completion
            self._progress.clear(num)
        except StageDeadlineExceeded as e:
            # Not a failure: the stage ran out of clock and stood down cleanly so
            # the invocation can still write its summary. The rotating window means
            # a later run picks up where this left off.
            with self._state_lock:
                self._cut_short_stages.append((num, str(e)))
            logger.warning(f"Stage {num} ({name}) CUT SHORT by the deadline: {e}")
            self._progress.save(num)
        except Exception as e:
            with self._state_lock:
                self._failed_stages.append((num, str(e)))
            logger.error(f"Stage {num} ({name}) FAILED: {e}", exc_info=True)
            # Save progress on failure so stage can be resumed
            self._progress.save(num)
        finally:
            release_stage_lock(num)
            with self._state_lock:
                if num in self._held_locks:
                    self._held_locks.remove(num)
        elapsed = time.time() - start
        logger.info(f"Stage {num} complete in {elapsed:.1f}s")

    def _print_summary(self, elapsed: float):
        """Print a final summary of the ETL run."""
        logger.info(f"\n{'='*60}")
        logger.info(f"ETL PIPELINE SUMMARY")
        logger.info(f"{'='*60}")
        logger.info(f"Total time: {elapsed:.1f}s")

        if self._completed_stages:
            logger.info(f"  Completed ({len(self._completed_stages)}): {self._completed_stages}")

        if self._skipped_stages:
            logger.warning(f"  Skipped  ({len(self._skipped_stages)}):")
            for num, missing in self._skipped_stages:
                name = STAGE_NAMES.get(num, f"Stage {num}")
                logger.warning(f"      Stage {num:2d} ({name}): {', '.join(missing)}")

        if self._cut_short_stages:
            logger.warning(f"  Cut short ({len(self._cut_short_stages)}) — hit the deadline mid-stage:")
            for num, why in self._cut_short_stages:
                name = STAGE_NAMES.get(num, f"Stage {num}")
                logger.warning(f"      Stage {num:2d} ({name}): {why}")

        if self._deferred_stages:
            logger.warning(
                f"  Deferred ({len(self._deferred_stages)}) — ran out of time, "
                f"a later run picks these up:"
            )
            for num, needed, remaining in self._deferred_stages:
                name = STAGE_NAMES.get(num, f"Stage {num}")
                logger.warning(f"      Stage {num:2d} ({name}): needed ~{needed}s, had {remaining}s")

        if self._failed_stages:
            logger.error(f"  Failed   ({len(self._failed_stages)}):")
            for num, err in self._failed_stages:
                name = STAGE_NAMES.get(num, f"Stage {num}")
                logger.error(f"      Stage {num:2d} ({name}): {err[:100]}")

        if self._provenance_audit_result is not None:
            totals = self._provenance_audit_result.get("totals", {})
            log_fn = logger.info if self._provenance_audit_result.get("ok", False) else logger.warning
            log_fn(
                "  Relationship provenance audit: total=%s, missing_source=%s, missing_last_confirmed=%s, missing_evidence=%s",
                totals.get("relationships", 0),
                totals.get("missing_source", 0),
                totals.get("missing_last_confirmed", 0),
                totals.get("missing_evidence", 0),
            )
            samples = self._provenance_audit_result.get("samples") or []
            if samples and not self._provenance_audit_result.get("ok", False):
                logger.warning("    Sample relationships missing provenance (first %s shown):", len(samples))
                for sample in samples[:5]:
                    logger.warning(
                        "      %s %s -> %s props=%s",
                        sample.get("rel_type"),
                        sample.get("from_labels"),
                        sample.get("to_labels"),
                        sample.get("rel_properties"),
                    )

        # Show stages with interrupted progress
        interrupted = []
        for stage_num in sorted(STAGE_NAMES.keys()):
            if self._progress.has_progress(stage_num):
                info = self._progress.get_progress_info(stage_num)
                if info:
                    interrupted.append((stage_num, info))
        if interrupted:
            logger.info(f"  Interrupted ({len(interrupted)}) — resume with --resume:")
            for num, info in interrupted:
                name = STAGE_NAMES.get(num, f"Stage {num}")
                pct = info["processed_count"] / max(info["total_items"], 1) * 100
                logger.info(
                    f"      Stage {num:2d} ({name}): "
                    f"{info['processed_count']}/{info['total_items']} ({pct:.0f}%)"
                )

        # Print final DB stats
        try:
            stats = self.writer.get_stats()
            logger.info(f"\nDatabase stats:")
            for label, count in sorted(stats.items()):
                logger.info(f"  {label:35} {count:>10,}")
        except Exception:
            logger.warning("Could not fetch database stats")

    # ── Stage Implementations ─────────────────────────────────

    def _stage_1_wikidata(self):
        """Stage 1: Wikidata base entities — companies, brands, subsidiaries, people."""
        # Companies with LEI
        companies_raw = self.wikidata.fetch_companies_with_lei()
        companies = []
        for c in companies_raw:
            lei = c.get("lei")
            if lei:
                self._lei_set.add(lei)
                companies.append({
                    "lei": lei,
                    "name": c.get("name", ""),
                    "wikidata_id": c.get("wikidata_id"),
                    "website": c.get("website"),
                    "logo_url": c.get("logo_url"),
                    "data_sources": ["wikidata"],
                    "sources_json": json.dumps([{
                        "source": "wikidata", "field": "name",
                        "value": c.get("name", ""), "fetched": now_iso(), "confidence": "high"
                    }]),
                    "last_updated": now_iso(),
                })
        self.writer.merge_companies(companies, merge_field="lei")
        # A node whose QID disagrees with Wikidata's owner of its LEI misroutes
        # every edge written by QID. It needs a supervised repair, so alert.
        wrong_qids = self.writer.find_lei_qid_disagreements(companies)
        if wrong_qids:
            sample = ", ".join(f"{w['name']} ({w['lei']}: {w['graph_qid']} should be {'/'.join(w['wikidata_qids'])})"
                               for w in wrong_qids[:5])
            logger.error(f"Stage 1: {len(wrong_qids)} companies carry a QID Wikidata gives to another item: "
                         f"{sample}. Run tools/identity/repair_lei_qid.py")

        # Brands
        brands_raw = self.wikidata.fetch_brands()
        brands = []
        brand_rels = []
        for b in brands_raw:
            wid = b.get("wikidata_id")
            if not wid:
                continue
            brands.append({
                "wikidata_id": wid,
                "name": b.get("name", ""),
                "website": b.get("website"),
                "logo_url": b.get("logo_url"),
                "data_sources": ["wikidata"],
                "sources_json": json.dumps([{
                    "source": "wikidata", "field": "name",
                    "value": b.get("name", ""), "fetched": now_iso(), "confidence": "high"
                }]),
                "last_updated": now_iso(),
            })
            if b.get("owner_wikidata_id"):
                brand_rels.append({
                    "brand_wikidata_id": wid,
                    "owner_wikidata_id": b["owner_wikidata_id"],
                })
        self.writer.merge_brands(brands)
        if brand_rels:
            self.writer.create_brand_ownership_rels(brand_rels)
        # Brand ownership is otherwise add-only, so an owner Wikidata now marks
        # as ended or as a minority shareholder would stay on the brand.
        standing = self.writer.get_brand_owner_pairs(source="wikidata")
        rejected = (getattr(self.wikidata, "rejected_brand_owners", set()) & standing) | \
            self.wikidata.rejected_owner_pairs(standing)
        if rejected:
            self.writer.retract_brand_owners(rejected, source="wikidata")

        # Subsidiaries — with investor filtering
        sub_rels_raw = self.wikidata.fetch_subsidiaries()
        financial_ids = self.wikidata.fetch_financial_entity_ids()

        sub_rels = []
        investor_rels = []
        dropped = 0

        for rel in sub_rels_raw:
            parent_id = rel.get("parent_wikidata_id")
            if parent_id in financial_ids:
                pct = rel.get("ownership_percentage")
                if pct is not None:
                    investor_rels.append({
                        "company_wikidata_id": rel["child_wikidata_id"],
                        "company_name": rel["child_name"],
                        "investor_wikidata_id": parent_id,
                        "investor_name": rel["parent_name"],
                        "ownership_percentage": pct,
                        "source_url": rel.get("source_url"),
                    })
                else:
                    dropped += 1
            else:
                sub_rels.append(rel)

        if dropped:
            logger.info(f"Stage 1: dropped {dropped} investor relationships without ownership %")
        # Shareholdings live on P127 with a share, not on P749.
        seen = {(r["company_wikidata_id"], r["investor_wikidata_id"]) for r in investor_rels}
        investor_rels += [r for r in self.wikidata.fetch_company_shareholders()
                          if (r["company_wikidata_id"], r["investor_wikidata_id"]) not in seen]
        # Wikidata knows the parent or the subsidiary of companies we already
        # hold; import that missing end so the ownership chain is not cut
        # (decided 2026-09-19). Pairs where neither end is in the graph — the
        # large majority — are left alone.
        known = self.writer.get_company_wikidata_ids()
        missing = {
            qid
            for rel in sub_rels
            for qid in (rel["child_wikidata_id"], rel["parent_wikidata_id"])
            if qid not in known
            and (rel["child_wikidata_id"] in known or rel["parent_wikidata_id"] in known)
        }
        if missing:
            labels = self.wikidata.fetch_labels(missing)
            # Unlabelled items would arrive as bare QIDs; leave those out.
            self.writer.create_companies_from_wikidata(
                [{"wikidata_id": q, "name": labels[q]} for q in sorted(missing) if q in labels],
                created_via="wikidata_ownership",
            )

        if sub_rels:
            self.writer.create_subsidiary_rels(sub_rels, source="wikidata")
        if investor_rels:
            self.writer.create_investor_rels(investor_rels, source="wikidata")

        # Build retraction key sets
        self._wikidata_sub_keys = {
            f"{r['child_wikidata_id']}|{r['parent_wikidata_id']}" for r in sub_rels
        }
        self._wikidata_investor_keys = {
            f"{r['company_wikidata_id']}|{r['investor_wikidata_id']}" for r in investor_rels
        }

        # The subsidiary fetch already read the P31 classes of every company in
        # a P749 pair, which covers the companies that have no LEI.
        self._write_business_flags({q: q not in self.wikidata.public_sector_items
                                    for q in self.wikidata.typed_items})

        # People (founders, CEOs, board members)
        people_raw = self.wikidata.fetch_people()
        persons = {}
        person_rels = []
        for p in people_raw:
            wid = p.get("person_wikidata_id")
            if not wid:
                continue
            if wid not in persons:
                persons[wid] = {
                    "wikidata_id": wid,
                    "name": p.get("person_name", ""),
                    "role": p.get("role"),
                    "data_sources": ["wikidata"],
                    "sources_json": json.dumps([{
                        "source": "wikidata", "field": "name",
                        "value": p.get("person_name", ""), "fetched": now_iso(), "confidence": "high"
                    }]),
                    "last_updated": now_iso(),
                }
            person_rels.append(p)
        self.writer.merge_persons(list(persons.values()))
        if person_rels:
            self.writer.create_person_rels(person_rels)

    def _write_business_flags(self, is_business: Dict[str, bool]):
        """Flag companies Wikidata does not class as a business (decided 2026-09-19).

        Only items whose classes were actually read appear here; an item with
        no P31 is left unflagged rather than assumed non-business.
        """
        if not is_business:
            return
        flags = [{"wikidata_id": qid, "non_business": not ok} for qid, ok in is_business.items()]
        self.writer.set_company_business_flags(flags)
        logger.info(f"  business check: {sum(1 for f in flags if f['non_business'])} of "
                    f"{len(flags)} classified items are not a business")

    def _stage_2_gleif(self):
        """Stage 2: GLEIF API — enrich companies with legal entity data."""
        if not self._lei_set:
            self._lei_set = set(self.writer.get_all_company_leis())
        if not self._lei_set:
            logger.warning("No LEIs found, skipping GLEIF stage")
            return

        gleif_companies, gleif_rels = self.gleif.fetch_all(self._lei_set)

        # Merge GLEIF data into existing companies
        companies = []
        for gc_data in gleif_companies:
            companies.append({
                "lei": gc_data["lei"],
                "legal_name": gc_data.get("legal_name"),
                "jurisdiction": gc_data.get("jurisdiction"),
                "country": gc_data.get("country"),
                "hq_city": gc_data.get("city"),
                "data_sources": ["wikidata", "gleif"],
                "sources_json": json.dumps([
                    {"source": "gleif", "field": "legal_name", "value": gc_data.get("legal_name", ""), "fetched": now_iso(), "confidence": "high"},
                    {"source": "gleif", "field": "country", "value": gc_data.get("country", ""), "fetched": now_iso(), "confidence": "high"},
                ]),
                "last_updated": now_iso(),
            })
        self.writer.merge_companies(companies, merge_field="lei")

        # GLEIF parent-child relationships
        if gleif_rels:
            self.writer.create_subsidiary_rels(gleif_rels, source="gleif")

        # Cross-reference: corroborate Wikidata rels confirmed by GLEIF
        gleif_keys = {f"{r['child_lei']}|{r['parent_lei']}" for r in gleif_rels}
        self.writer.corroborate_ownership_rels(gleif_keys)
        self._gleif_sub_keys = gleif_keys

    def _retract_stale_ownership(self):
        """Delete ownership relationships that sources no longer report."""
        if hasattr(self, '_wikidata_sub_keys'):
            self.writer.retract_stale_ownership_rels(
                self._wikidata_sub_keys, source="wikidata", rel_type="SUBSIDIARY_OF"
            )
        if hasattr(self, '_wikidata_investor_keys'):
            self.writer.retract_stale_ownership_rels(
                self._wikidata_investor_keys, source="wikidata", rel_type="INVESTED_IN_BY"
            )
        if hasattr(self, '_gleif_sub_keys'):
            self.writer.retract_stale_ownership_rels(
                self._gleif_sub_keys, source="gleif", rel_type="SUBSIDIARY_OF"
            )

    def _stage_3_openfoodfacts(self):
        """Stage 3: Open Food/Beauty/Products Facts."""
        names = self._limit_names(3)
        results = openfoodfacts.enrich(names, self.config)
        products = results.get("products", [])
        if products:
            self.writer.merge_products(products)
        rels = results.get("brand_product_rels", [])
        if rels:
            self.writer.create_product_brand_rels(rels)

    def _stage_4_wikidata_products(self):
        """Stage 4: Wikidata ASINs and UPCs."""
        results = wikidata_product_ids.enrich(self.config)
        products = results.get("products", [])
        barcode_products = [p for p in products if p.get("barcode")]
        asin_products = [p for p in products if p.get("asin") and not p.get("barcode")]
        if barcode_products:
            self.writer.merge_products(barcode_products)
        if asin_products:
            self.writer.merge_products_by_asin(asin_products)
        rels = results.get("brand_product_rels", [])
        if rels:
            self.writer.create_product_brand_rels(rels)

    def _stage_5_logos(self):
        """Stage 5: logo.dev hotlinks — gap-fill for companies and brands with a website."""
        for label in ("Company", "Brand"):
            entities = self.writer.get_entities_without_logos(label)
            logger.info(f"Stage 5: {len(entities)} {label} nodes need a logo (gap-fill after Wikidata)")
            logos = logo_dev.enrich(entities, self.config)
            if logos:
                self.writer.update_logos(logos)

    def _stage_6_sec_edgar(self):
        """Stage 6: SEC EDGAR supply chain."""
        cik_companies = self.writer.get_companies_with_cik()
        if not cik_companies:
            logger.info("Stage 6: no companies with CIK, skipping")
            return
        limit = self._get_stage_limit(6)
        if limit > 0:
            cik_companies = cik_companies[:limit]
        cb = lambda name, i: self._save_progress_periodic(6, name, i)
        results = sec_edgar.enrich(cik_companies, self.config, on_progress=cb)
        supply_rels = results.get("supply_rels", [])
        if supply_rels:
            self.writer.create_supply_rels(supply_rels, self._resolver())

    def _stage_7_fec(self):
        """Stage 7: what companies' PACs gave federal candidates (FEC bulk files)."""
        donations = fec_pac.fetch_pac_donations()
        resolver = self._resolver()
        # A PAC's connected organization is American; a unique name match to a
        # company recorded elsewhere is a same-name collision (Weis Markets vs
        # Unilever's Australian "Weis"), so it is dropped, not written.
        keys = {}
        for d in donations:
            hit = resolver.resolve(d["company_name"])
            if hit:
                keys[d["company_name"]] = (hit[0].key_field, hit[0].key)
        countries = self.writer.get_company_countries(list(keys.values()))
        us = {"United States", "United States of America", "US", "USA"}
        kept = [d for d in donations
                if d["company_name"] in keys and countries.get(keys[d["company_name"]]) in us | {None}]
        # Two PAC name spellings can resolve to one company; add them up for the
        # same candidate and cycle rather than letting the second overwrite.
        merged: Dict[tuple, Dict] = {}
        for d in kept:
            k = (keys[d["company_name"]], d["fec_id"])
            if k not in merged or d["year"] > merged[k]["year"]:
                merged[k] = dict(d)
            elif d["year"] == merged[k]["year"]:
                merged[k]["amount"] = round(merged[k]["amount"] + d["amount"], 2)
        kept = list(merged.values())
        logger.info(f"Stage 7: {len(kept):,} of {len(donations):,} PAC contributions resolve to a US company "
                    f"({len({k for k in keys.values()}):,} companies)")
        if kept:
            self.writer.create_donation_rels(kept, resolver, source="fec_pac")

    def _stage_8_sec_13f(self):
        """Stage 8: SEC 13F institutional investor holdings."""
        from enrichment import sec_13f
        companies = self.writer.get_companies_with_ciks_and_tickers()
        if not companies:
            logger.info("Stage 8: no companies with CIK/ticker, skipping")
            return
        limit = self._get_stage_limit(8)
        if limit > 0:
            companies = companies[:limit]
        cb = lambda name, i: self._save_progress_periodic(8, name, i)
        results = sec_13f.enrich(companies, self.config, on_progress=cb)
        if results:
            self.writer.create_investor_rels(results, source="sec_13f")

    def _stage_10_followthemoney(self):
        """Stage 10: FollowTheMoney state donations."""
        names = self._limit_names(10)
        cb = lambda name, i: self._save_progress_periodic(10, name, i)
        donations = followthemoney.enrich(names, self.config, on_progress=cb)
        if donations:
            self.writer.create_donation_rels(donations, self._resolver(), source="followthemoney")

    def _stage_11_violations(self):
        """Stage 11: Violation Tracker corporate penalties."""
        names = self._limit_names(11)
        cb = lambda name, i: self._save_progress_periodic(11, name, i)
        violations = violation_tracker.enrich(names, self.config, on_progress=cb)
        if violations:
            self.writer.merge_violations(violations, self._resolver())

    def _stage_12_wikirate(self):
        """Stage 12: WikiRate ESG scores."""
        names = self._limit_names(12)
        cb = lambda name, i: self._save_progress_periodic(12, name, i)
        scores = wikirate.enrich(names, self.config, on_progress=cb)
        if scores:
            self.writer.merge_esg_scores(scores, self._resolver())

    def _stage_13_open_supply_hub(self):
        """Stage 13: Open Supply Hub facilities."""
        names = self._limit_names(13)
        cb = lambda name, i: self._save_progress_periodic(13, name, i)
        facilities = open_supply_hub.enrich(names, self.config, on_progress=cb)
        if facilities:
            self.writer.merge_facilities(facilities, self._resolver())

    def _stage_14_wikidata_extended(self):
        """Stage 14: Wikidata extended properties, and the non-business flag."""
        extended, types = wikidata_extended.enrich(self.config)
        if extended:
            self.writer.update_company_extended(extended)
        # LEI holders include universities, cities and other public bodies.
        # Flag them so search can leave them out (decided 2026-09-19); the
        # classes come from the same query, and items with no P31 stay
        # unflagged.
        self._write_business_flags({qid: not self.wikidata.is_public_sector(classes)
                                    for qid, classes in types.items()})

    def _stage_15_sec_proxy(self):
        """Stage 15: SEC proxy executive compensation."""
        cik_companies = self.writer.get_companies_with_cik()
        if not cik_companies:
            logger.info("Stage 15: no companies with CIK, skipping")
            return
        limit = self._get_stage_limit(15)
        if limit > 0:
            cik_companies = cik_companies[:limit]
        cb = lambda name, i: self._save_progress_periodic(15, name, i)
        comp_data = sec_proxy.enrich(cik_companies, self.config, on_progress=cb)
        if comp_data:
            self.writer.update_exec_compensation(comp_data)

    def _stage_16_epa_echo(self):
        """Stage 16: EPA ECHO environmental violations."""
        names = self._limit_names(16)
        cb = lambda name, i: self._save_progress_periodic(16, name, i)
        violations = epa_echo.enrich(names, self.config, on_progress=cb)
        if violations:
            self.writer.merge_environmental_violations(violations, self._resolver())

    def _stage_17_subsidies(self):
        """Stage 17: Subsidy Tracker corporate subsidies."""
        names = self._limit_names(17)
        cb = lambda name, i: self._save_progress_periodic(17, name, i)
        subs = subsidy_tracker.enrich(names, self.config, on_progress=cb)
        if subs:
            self.writer.merge_subsidies(subs, self._resolver())

    def _stage_18_osha(self):
        """Stage 18: OSHA workplace violations (bulk CSV)."""
        names = self._limit_names(18)
        violations = osha_violations.enrich(names, self.config)
        if violations:
            self.writer.merge_violations(violations, self._resolver())

    def _stage_19_usaspending(self):
        """Stage 19: USAspending government contracts."""
        names = self._limit_names(19)
        cb = lambda name, i: self._save_progress_periodic(19, name, i)
        contracts = usaspending.enrich(names, self.config, on_progress=cb)
        if contracts:
            self.writer.merge_government_contracts(contracts, self._resolver())

    def _stage_20_cfpb(self):
        """Stage 20: CFPB consumer complaints."""
        names = self._limit_names(20)
        cb = lambda name, i: self._save_progress_periodic(20, name, i)
        complaints = cfpb_complaints.enrich(names, self.config, on_progress=cb)
        if complaints:
            self.writer.merge_consumer_complaints(complaints, self._resolver())

    def _stage_21_fda_recalls(self):
        """Stage 21: FDA food and drug recalls."""
        names = self._limit_names(21)
        cb = lambda name, i: self._save_progress_periodic(21, name, i)
        recalls = fda_recalls.enrich(names, self.config, on_progress=cb)
        if recalls:
            self.writer.merge_recalls(recalls, self._resolver())

    def _stage_22_cpsc_recalls(self):
        """Stage 22: CPSC consumer product recalls."""
        names = self._limit_names(22)
        cb = lambda name, i: self._save_progress_periodic(22, name, i)
        recalls = cpsc_recalls.enrich(names, self.config, on_progress=cb)
        if recalls:
            self.writer.merge_recalls(recalls, self._resolver())

    def _stage_23_icij_offshore(self):
        """Stage 23: ICIJ Offshore Leaks (bulk CSV)."""
        names = self._limit_names(23)
        entities = icij_offshore.enrich(names, self.config)
        if entities:
            self.writer.merge_offshore_entities(entities, self._resolver())

    def _stage_24_uk_companies_house(self):
        """Stage 24: UK Companies House registration data."""
        names = self._limit_names(24)
        cb = lambda name, i: self._save_progress_periodic(24, name, i)
        result = uk_companies_house.enrich(names, self.config, on_progress=cb)
        companies = result.get("companies", [])
        if companies:
            for c in companies:
                c["data_sources"] = ["uk_companies_house"]
                c["last_updated"] = now_iso()
            self.writer.update_uk_company_registrations(companies, self._resolver())
        persons = result.get("persons", [])
        if persons:
            self.writer.merge_uk_psc_relationships(persons, self._resolver())
        return len(companies) + len(persons)

    def _stage_25_ofac(self):
        """Stage 25: OFAC SDN and Consolidated sanctions lists."""
        companies = self.writer.get_companies_for_screening()
        self.writer.set_ofac_sanctions(ofac_sanctions.enrich(companies))

    def _stage_27_aggregates(self):
        """Stage 27: Aggregate score computation (internal Cypher)."""
        self.writer.update_aggregate_scores()


def print_status(config: Config):
    """Show checkpoint and progress status of all stages."""
    checkpoint_dir = os.path.join(os.path.dirname(__file__), "checkpoints")
    progress_dir = os.path.join(checkpoint_dir, "progress")
    results = check_all_stages()
    today = time.strftime("%Y-%m-%d")

    print("\n" + "=" * 80)
    print("  BOYK ETL — STAGE STATUS")
    print("=" * 80)
    print(f"  {'Stage':6s}  {'Name':40s}  {'Status':20s}  {'Details'}")
    print("  " + "-" * 76)

    for stage_num in sorted(STAGE_NAMES.keys()):
        name = STAGE_NAMES[stage_num]
        can_run, missing = results.get(stage_num, (True, []))

        # Check for active lock
        lock_file = _lock_path(stage_num)
        is_locked = False
        if os.path.exists(lock_file):
            try:
                with open(lock_file, "r") as f:
                    lock_data = json.load(f)
                if _is_pid_alive(lock_data.get("pid", 0)):
                    is_locked = True
            except Exception:
                pass

        # Check for progress (interrupted)
        progress_file = os.path.join(progress_dir, f"stage_{stage_num}_progress.json")
        has_progress = False
        progress_info = None
        if os.path.exists(progress_file):
            try:
                with open(progress_file, "r") as f:
                    progress_info = json.load(f)
                has_progress = True
            except Exception:
                pass

        # Check for checkpoint
        cp_file = os.path.join(checkpoint_dir, f"stage_{stage_num}.json")
        cp_data = None
        if os.path.exists(cp_file):
            try:
                with open(cp_file, "r") as f:
                    cp_data = json.load(f)
            except Exception:
                pass

        # Determine status
        if is_locked:
            status = "RUNNING"
            details = f"PID {lock_data.get('pid', '?')}"
        elif has_progress and progress_info:
            status = "INTERRUPTED"
            pct = progress_info["processed_count"] / max(progress_info["total_items"], 1) * 100
            details = f"{progress_info['processed_count']}/{progress_info['total_items']} ({pct:.0f}%)"
        elif cp_data:
            completed = cp_data.get("completed_at", "")
            is_today = completed.startswith(today)
            status = "DONE (today)" if is_today else "DONE"
            records = cp_data.get("records_written", 0)
            duration = cp_data.get("duration_seconds", 0)
            date_str = completed[:10] if completed else "?"
            details = f"{records:,} records, {duration:.0f}s" + (f" ({date_str})" if not is_today else "")
        elif not can_run:
            status = "NO API KEY"
            details = ", ".join(missing)
        else:
            status = "NOT RUN"
            details = ""

        print(f"  {stage_num:5d}   {name:40s}  {status:20s}  {details}")

    print("=" * 80)

    # Summary
    lock_count = sum(1 for s in STAGE_NAMES if os.path.exists(_lock_path(s)))
    interrupted = sum(
        1 for s in STAGE_NAMES
        if os.path.exists(os.path.join(progress_dir, f"stage_{s}_progress.json"))
    )
    if interrupted > 0:
        print(f"\n  {interrupted} stage(s) have interrupted progress.")
        print(f"  Resume with: python run_etl.py --run --resume --stages <N>")
    if lock_count > 0:
        print(f"  {lock_count} stage(s) currently locked (running or stale).")
    print()


def main():
    parser = argparse.ArgumentParser(description="Boyk ETL Pipeline v2")
    parser.add_argument("--run", action="store_true", help="Run ETL pipeline")
    parser.add_argument("--stages", type=str, default=None,
                        help="Comma-separated stage numbers to run (e.g., '1,2,7,11')")
    parser.add_argument("--force", action="store_true",
                        help="Skip today's checkpoint (re-run completed stages)")
    parser.add_argument("--force-keys", action="store_true",
                        help="Attempt stages even with missing API keys")
    parser.add_argument("--resume", action="store_true",
                        help="Resume interrupted stages from saved progress")
    parser.add_argument("--check", action="store_true",
                        help="Check which stages can run with current env vars")
    parser.add_argument("--status", action="store_true",
                        help="Show checkpoint and progress status of all stages")
    parser.add_argument("--stats", action="store_true", help="Show database stats")
    parser.add_argument("--clear", action="store_true", help="Clear database")
    parser.add_argument("--audit-rel-provenance", action="store_true",
                        help="Audit graph relationship provenance/evidence fields")
    parser.add_argument("--backfill-rel-provenance", action="store_true",
                        help="Backfill/flag legacy relationship provenance fields")
    parser.add_argument("--fail-on-missing-rel-provenance", action="store_true",
                        help="Exit non-zero if relationship provenance audit finds gaps")

    args = parser.parse_args()
    config = Config()

    if args.status:
        print_status(config)
        return

    if args.check:
        print("\n" + "=" * 65)
        print("  BOYK ETL — STAGE READINESS CHECK")
        print("=" * 65)
        results = check_all_stages()
        for stage_num in sorted(results.keys()):
            can_run, missing = results[stage_num]
            name = STAGE_NAMES.get(stage_num, f"Stage {stage_num}")
            if can_run:
                print(f"  Stage {stage_num:2d}  {name:40s}  ready")
            else:
                print(f"  Stage {stage_num:2d}  {name:40s}  missing: {', '.join(missing)}")
        runnable = sum(1 for can, _ in results.values() if can)
        print(f"\n  {runnable}/{len(results)} stages ready to run")
        print("=" * 65)
        return

    if args.clear:
        writer = Neo4jWriter(config)
        confirm = input("This will DELETE ALL DATA. Type 'yes' to confirm: ")
        if confirm.strip().lower() == "yes":
            writer.clear_database()
            print("Database cleared.")
        else:
            print("Aborted.")
        writer.close()
        return

    if args.stats:
        writer = Neo4jWriter(config)
        stats = writer.get_stats()
        print("\n" + "=" * 55)
        print("  BOYK DATABASE STATISTICS")
        print("=" * 55)
        for label, count in sorted(stats.items()):
            print(f"  {label:40} {count:>10,}")
        print("=" * 55)
        writer.close()
        return

    if (args.audit_rel_provenance or args.backfill_rel_provenance or args.fail_on_missing_rel_provenance) and not args.run:
        writer = Neo4jWriter(config)
        exit_code = 0
        try:
            if args.backfill_rel_provenance:
                res = writer.backfill_relationship_provenance()
                print(
                    f"Backfilled relationship provenance on {res['total_rels']} rels "
                    f"(flagged {res['flagged_missing_source']} with legacy_unknown source)"
                )
            if args.audit_rel_provenance or args.fail_on_missing_rel_provenance:
                audit = writer.audit_relationship_provenance(
                    sample_limit=int(getattr(config, "etl_provenance_audit_sample_limit", 20) or 20)
                )
                totals = audit.get("totals", {})
                print(
                    "Relationship provenance audit: "
                    f"total={totals.get('relationships', 0)}, "
                    f"missing_source={totals.get('missing_source', 0)}, "
                    f"missing_last_confirmed={totals.get('missing_last_confirmed', 0)}, "
                    f"missing_evidence={totals.get('missing_evidence', 0)}"
                )
                if not audit.get("ok", False):
                    samples = audit.get("samples", [])[:5]
                    if samples:
                        print("Sample failing relationships:")
                        for sample in samples:
                            print(
                                f"  {sample.get('rel_type')} {sample.get('from_labels')} -> "
                                f"{sample.get('to_labels')} props={sample.get('rel_properties')}"
                            )
                    if args.fail_on_missing_rel_provenance:
                        exit_code = 2
        finally:
            writer.close()
        if exit_code:
            sys.exit(exit_code)
        return

    if args.run:
        # Validate critical config
        if not config.validate():
            logger.error("Critical config validation failed. Fix the errors above and retry.")
            sys.exit(1)

        if args.audit_rel_provenance:
            config.etl_audit_relationship_provenance = True
        if args.backfill_rel_provenance:
            config.etl_backfill_relationship_provenance = True
        if args.fail_on_missing_rel_provenance:
            config.etl_fail_on_missing_relationship_provenance = True

        stages = None
        if args.stages:
            stages = [int(s.strip()) for s in args.stages.split(",")]

        # Acquire global concurrency lock
        acquire_lock()

        pipeline = ETLPipeline(
            config,
            force=args.force,
            force_keys=args.force_keys,
            resume=args.resume,
        )
        try:
            pipeline.run(stages=stages)
        finally:
            pipeline.close()
            release_lock()

        # Exit with error code if any stages failed
        if pipeline._failed_stages:
            sys.exit(1)
        return

    parser.print_help()


if __name__ == "__main__":
    main()
