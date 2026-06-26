"""
rca_agent — 4-Step Root Cause Analysis Engine.

Analyses parquet telemetry data (metrics, traces, logs) to answer
root-cause-analysis queries: identifying the failure time, component,
and reason from raw observability signals.
"""

from rca_agent.engine import RCAEngine

__all__ = ["RCAEngine"]
