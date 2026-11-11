"""Shared fixtures for ETL tests."""

import sys
from pathlib import Path

import pytest

# Add etl/ to path so we can import modules directly
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
