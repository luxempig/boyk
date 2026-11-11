"""
Stage 27: Aggregate Score Computation
Computes rolled-up scores on Company nodes using Cypher queries.
This stage has no external API — it runs internal database queries.
"""

import logging

from config import Config

logger = logging.getLogger(__name__)


def enrich(config: Config) -> bool:
    """
    This stage is handled directly by neo4j_writer.update_aggregate_scores().
    Returns True to signal the caller to run the aggregate update.
    """
    logger.info("Stage 27: Aggregate score computation delegated to neo4j_writer")
    return True
