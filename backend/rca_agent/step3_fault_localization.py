"""
step3_fault_localization.py — Fault Localization Engine.

Correlates app-level anomalies with trace topology and infrastructure
metrics to identify the blamed component.  Uses:
  1. Trace tree traversal (deepest anomalous downstream node)
  2. Cross-correlation of app degradation ↔ infra KPI spikes
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd
from scipy import stats as scipy_stats

from rca_agent import data_loader
from rca_agent.step1_anomaly_engine import AnomalyReport, InfraAnomaly
from rca_agent.step2_trace_graph import TraceGraph, get_downstream


@dataclass
class FaultCandidate:
    """A candidate blamed component with supporting evidence."""
    cmdb_id: str
    score: float                  # combined score (higher = more likely)
    trace_zscore: float = 0.0     # duration Z-score from trace analysis
    infra_zscore: float = 0.0     # max KPI Z-score from infra analysis
    top_kpi: str = ""             # most anomalous KPI name
    top_kpi_reason: str = ""      # human-readable reason
    correlation: float = 0.0      # cross-correlation with app degradation
    evidence: list[str] = field(default_factory=list)


@dataclass
class FaultLocalizationResult:
    """Output of the fault localization step."""
    candidates: list[FaultCandidate] = field(default_factory=list)
    blamed_component: str = ""
    blamed_kpi: str = ""
    blamed_reason: str = ""
    blamed_timestamp: int = 0


def _rank_by_infra_anomalies(
    anomaly_report: AnomalyReport,
    t_start: int,
    t_end: int,
) -> dict[str, FaultCandidate]:
    """
    Rank cmdb_ids by their infrastructure anomaly severity.
    Groups infra anomalies by cmdb_id and picks the most anomalous KPI.
    """
    candidates: dict[str, FaultCandidate] = {}

    for ia in anomaly_report.infra_anomalies:
        if ia.cmdb_id not in candidates:
            candidates[ia.cmdb_id] = FaultCandidate(
                cmdb_id=ia.cmdb_id,
                score=0.0,
                evidence=[],
            )

        c = candidates[ia.cmdb_id]

        # Track the highest Z-score KPI
        if abs(ia.zscore) > abs(c.infra_zscore):
            c.infra_zscore = ia.zscore
            c.top_kpi = ia.kpi_name
            c.top_kpi_reason = ia.reason

        c.evidence.append(
            f"{ia.kpi_name}: z={ia.zscore:.1f}, val={ia.value:.2f} @ {ia.timestamp}"
        )

    return candidates


def _rank_by_trace_graph(
    trace_graph: TraceGraph,
) -> dict[str, float]:
    """
    Rank cmdb_ids by trace-based anomaly signals.
    Returns cmdb_id → score based on duration Z-score and anomalous span count.
    """
    scores: dict[str, float] = {}
    for cid, node in trace_graph.nodes.items():
        # Weighted score: duration Z-score + fraction of anomalous spans
        span_fraction = (
            node.anomalous_spans / max(node.span_count, 1)
        )
        scores[cid] = node.duration_zscore + span_fraction * 2.0

    return scores


def _cross_correlate_with_app(
    anomaly_report: AnomalyReport,
    cmdb_ids: list[str],
    t_start: int,
    t_end: int,
) -> dict[str, float]:
    """
    Compute cross-correlation between app metric degradation and
    each cmdb_id's infrastructure KPIs.

    Returns cmdb_id → max absolute correlation coefficient.
    """
    if not anomaly_report.app_anomalies:
        return {}

    # Build app degradation signal (mrt values as proxy)
    ma = data_loader.metric_app()
    app_window = ma[
        (ma["timestamp_s"] >= t_start) & (ma["timestamp_s"] <= t_end)
    ].copy()

    if app_window.empty:
        return {}

    # Aggregate mrt across all services by minute
    app_signal = (
        app_window.groupby("minute_bucket")["mrt"]
        .mean()
        .sort_index()
    )

    if len(app_signal) < 3:
        return {}

    # Load container metrics for the candidate cmdb_ids
    mc = data_loader.metric_container()
    mc_window = mc[
        (mc["timestamp_s"] >= t_start)
        & (mc["timestamp_s"] <= t_end)
        & (mc["cmdb_id"].isin(cmdb_ids))
    ].copy()

    if mc_window.empty:
        return {}

    correlations: dict[str, float] = {}

    for cmdb_id, cgrp in mc_window.groupby("cmdb_id"):
        cid = str(cmdb_id)
        max_corr = 0.0

        for kpi_name, kgrp in cgrp.groupby("kpi_name"):
            kpi_signal = (
                kgrp.groupby("minute_bucket")["value"]
                .mean()
                .sort_index()
            )

            # Align the two signals on minute_bucket
            common_idx = app_signal.index.intersection(kpi_signal.index)
            if len(common_idx) < 3:
                continue

            a = app_signal.loc[common_idx].values
            k = kpi_signal.loc[common_idx].values

            # Skip constant arrays (no correlation defined)
            if np.std(a) == 0 or np.std(k) == 0:
                continue

            # Spearman rank correlation (more robust to outliers)
            try:
                import warnings
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore")
                    corr, _ = scipy_stats.spearmanr(a, k)
                if not np.isnan(corr) and abs(corr) > abs(max_corr):
                    max_corr = float(corr)
            except Exception:
                continue

        correlations[cid] = max_corr

    return correlations


def localize_fault(
    anomaly_report: AnomalyReport,
    trace_graph: TraceGraph | None,
    t_start: int,
    t_end: int,
) -> FaultLocalizationResult:
    """
    Run fault localization combining infra anomalies, trace topology,
    and cross-correlation to identify the blamed component.

    Args:
        anomaly_report: Output from Step 1.
        trace_graph: Output from Step 2 (may be None if traces unavailable).
        t_start: Incident window start (epoch seconds).
        t_end: Incident window end (epoch seconds).

    Returns:
        FaultLocalizationResult with ranked candidates.
    """
    result = FaultLocalizationResult()

    # ── Score from infra anomalies ───────────────────────────────────────────
    candidates = _rank_by_infra_anomalies(anomaly_report, t_start, t_end)

    # ── Score from trace graph ───────────────────────────────────────────────
    if trace_graph and trace_graph.nodes:
        trace_scores = _rank_by_trace_graph(trace_graph)
        for cid, tscore in trace_scores.items():
            if cid not in candidates:
                candidates[cid] = FaultCandidate(
                    cmdb_id=cid, score=0.0, evidence=[]
                )
            candidates[cid].trace_zscore = tscore

    # ── Cross-correlation ────────────────────────────────────────────────────
    all_cmdb_ids = list(candidates.keys())
    if all_cmdb_ids:
        correlations = _cross_correlate_with_app(
            anomaly_report, all_cmdb_ids, t_start, t_end
        )
        for cid, corr in correlations.items():
            if cid in candidates:
                candidates[cid].correlation = corr

    # ── Combined scoring ─────────────────────────────────────────────────────
    for cid, c in candidates.items():
        # Weighted combination of signals
        c.score = (
            abs(c.infra_zscore) * 2.0       # infra anomaly is strongest signal
            + abs(c.trace_zscore) * 1.5      # trace anomaly
            + abs(c.correlation) * 1.0       # cross-correlation
        )

    # Sort by score descending
    ranked = sorted(candidates.values(), key=lambda x: x.score, reverse=True)
    result.candidates = ranked

    if ranked:
        top = ranked[0]
        result.blamed_component = top.cmdb_id
        result.blamed_kpi = top.top_kpi
        result.blamed_reason = top.top_kpi_reason

        # Find the timestamp of the most anomalous point for this component
        for ia in anomaly_report.infra_anomalies:
            if ia.cmdb_id == top.cmdb_id:
                result.blamed_timestamp = ia.timestamp
                break

    return result
