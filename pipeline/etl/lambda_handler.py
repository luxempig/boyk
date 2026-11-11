"""
AWS Lambda Handler for Boyk ETL
Each stage can be invoked independently by EventBridge.

Event format:
    {"stage": 1}        # Run single stage
    {"stages": [1, 2]}  # Run multiple stages
    {"stage": "all"}    # Run all stages
"""

import json
import logging
import os

from config import Config
from run_etl import ETLPipeline

logger = logging.getLogger()
logger.setLevel(logging.INFO)


def handler(event, context):
    """Lambda entry point."""
    config = Config()
    force = event.get("force", False)
    force_keys = event.get("force_keys", False)

    # Let the pipeline see the invocation deadline so it declines to start a stage
    # it cannot finish. Without this the runtime kills the run mid-write, with no
    # summary and no alert.
    deadline_fn = None
    if context is not None and hasattr(context, "get_remaining_time_in_millis"):
        deadline_fn = lambda: context.get_remaining_time_in_millis() / 1000.0

    pipeline = ETLPipeline(config, force=force, force_keys=force_keys,
                           deadline_fn=deadline_fn)

    try:
        stage = event.get("stage")
        stages = event.get("stages")

        if stage == "all" or (not stage and not stages):
            pipeline.run()
        elif stages:
            pipeline.run(stages=[int(s) for s in stages])
        elif stage:
            pipeline.run(stages=[int(stage)])
        else:
            pipeline.run()

        stats = pipeline.writer.get_stats()
        return {
            "statusCode": 200,
            "body": json.dumps({
                "message": "ETL complete",
                "stats": stats,
            }),
        }
    except Exception as e:
        logger.error(f"ETL failed: {e}", exc_info=True)
        return {
            "statusCode": 500,
            "body": json.dumps({"error": str(e)}),
        }
    finally:
        pipeline.close()
