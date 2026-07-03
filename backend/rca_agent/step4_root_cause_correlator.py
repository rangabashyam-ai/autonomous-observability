"""
step4_root_cause_correlator.py — Root Cause Correlator (Logs & Infra).

Once fault localization narrows the failure to a specific cmdb_id
and time window, this step dives into raw infrastructure metrics
and application logs to determine *why* it failed.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from rca_agent import data_loader


@dataclass
class RootCauseEvidence:
    """A piece of evidence supporting a root cause determination."""
    source: str          # "infra_metric" or "log"
    detail: str          # human-readable description
    value: float = 0.0   # metric value or Z-score
    timestamp: int = 0   # epoch seconds


@dataclass
class RootCauseResult:
    """Final output: what component failed, when, and why."""
    component: str
    reason: str
    timestamp: int                     # best-estimate occurrence time
    confidence: float = 0.0            # 0.0–1.0
    evidence: list[RootCauseEvidence] = field(default_factory=list)


# ── KPI category grouping ───────────────────────────────────────────────────
# Group related KPIs to find the dominant failure mode

_REASON_PRIORITY = [
    # Higher priority = checked first (most specific → least)
    "JVM Out of Memory (OOM) Heap",
    "high JVM CPU load",
    "network packet loss",
    "network latency",
    "high disk I/O read usage",
    "high disk space usage",
    "high CPU usage",
    "high memory usage",
]


def _rank_infra_kpis(
    cmdb_id: str,
    t_start: int,
    t_end: int,
    lookback: int = 3600,
) -> list[tuple[str, str, float, int]]:
    """
    For a specific cmdb_id, rank infrastructure KPIs by anomaly severity.

    Returns list of (kpi_name, reason, zscore, peak_timestamp) sorted by |zscore|.
    """
    mc = data_loader.metric_container()
    baseline_start = t_start - lookback

    host_data = mc[
        (mc["cmdb_id"] == cmdb_id)
        & (mc["timestamp_s"] >= baseline_start)
        & (mc["timestamp_s"] <= t_end)
    ].copy()

    if host_data.empty:
        return []

    results: list[tuple[str, str, float, int]] = []

    for kpi_name, grp in host_data.groupby("kpi_name"):
        grp = grp.sort_values("timestamp_s")
        if len(grp) < 3:
            continue

        values = grp["value"]
        med = values.median()
        mad = np.median(np.abs(values - med))

        if mad == 0:
            std = values.std()
            if std == 0:
                continue
            z_series = (values - values.mean()) / std
        else:
            z_series = 0.6745 * (values - med) / mad

        # Look at the target window only
        in_target = grp["timestamp_s"].between(t_start, t_end)
        target_z = z_series[in_target]

        if target_z.empty:
            continue

        # Find the peak anomaly in the target window
        peak_idx = target_z.abs().idxmax()
        peak_z = float(z_series.loc[peak_idx])
        peak_ts = int(grp.loc[peak_idx, "timestamp_s"])

        reason = data_loader.kpi_to_reason(str(kpi_name))
        if reason != "unknown":
            results.append((str(kpi_name), reason, peak_z, peak_ts))

    results.sort(key=lambda x: abs(x[2]), reverse=True)
    return results


def _check_logs(
    cmdb_id: str,
    t_start: int,
    t_end: int,
) -> list[tuple[str, int]]:
    """
    Parse logs for the cmdb_id in the time window.
    Returns list of (reason, timestamp) for detected failure patterns.
    """
    try:
        logs = data_loader.log_service_window(t_start, t_end)
    except Exception:
        return []

    if logs.empty:
        return []

    host_logs = logs[logs["cmdb_id"] == cmdb_id]
    if host_logs.empty:
        return []

    findings: list[tuple[str, int]] = []

    for _, row in host_logs.iterrows():
        reason = data_loader.log_to_reason(str(row.get("value", "")))
        if reason:
            findings.append((reason, int(row.get("timestamp_s", 0))))

    # Also check for high log frequency (burst of GC logs = memory pressure)
    gc_logs = host_logs[host_logs["log_name"] == "gc"]
    if not gc_logs.empty:
        # Count GC events per minute
        gc_per_min = gc_logs.groupby("minute_bucket").size()
        if gc_per_min.max() > 10:  # high GC frequency threshold
            peak_minute = int(gc_per_min.idxmax())
            findings.append(("high memory usage", peak_minute))

    return findings


def determine_root_cause(
    cmdb_id: str,
    t_start: int,
    t_end: int,
    hint_reason: str = "",
    lookback: int = 3600,
) -> RootCauseResult:
    """
    Determine the root cause reason for a specific component.

    Combines infrastructure KPI ranking with log analysis to produce
    the final root cause reason.

    Args:
        cmdb_id: The blamed component from fault localization.
        t_start: Incident window start.
        t_end: Incident window end.
        hint_reason: Optional hint from fault localization's KPI analysis.
        lookback: Baseline lookback in seconds.

    Returns:
        RootCauseResult with the component, reason, timestamp, and evidence.
    """
    evidence: list[RootCauseEvidence] = []
    reason_votes: dict[str, float] = {}

    # ── Infrastructure KPI analysis ──────────────────────────────────────────
    kpi_rankings = _rank_infra_kpis(cmdb_id, t_start, t_end, lookback)

    best_kpi_ts = 0
    for kpi_name, reason, zscore, peak_ts in kpi_rankings[:10]:
        evidence.append(RootCauseEvidence(
            source="infra_metric",
            detail=f"{kpi_name} → {reason} (z={zscore:.1f})",
            value=zscore,
            timestamp=peak_ts,
        ))
        # Vote with weight = |zscore|
        reason_votes[reason] = reason_votes.get(reason, 0) + abs(zscore)

        if not best_kpi_ts:
            best_kpi_ts = peak_ts

    # ── Log analysis ─────────────────────────────────────────────────────────
    log_findings = _check_logs(cmdb_id, t_start, t_end)

    for reason, ts in log_findings:
        evidence.append(RootCauseEvidence(
            source="log",
            detail=f"Log pattern detected: {reason}",
            timestamp=ts,
        ))
        # Log evidence is strong — weighted heavily
        reason_votes[reason] = reason_votes.get(reason, 0) + 5.0

    # ── Determine final reason ───────────────────────────────────────────────
    if reason_votes:
        # Pick the reason with highest total vote weight
        final_reason = max(reason_votes, key=reason_votes.get)  # type: ignore
        max_vote = reason_votes[final_reason]
        total_votes = sum(reason_votes.values())
        confidence = min(max_vote / max(total_votes, 1), 1.0)
    elif hint_reason and hint_reason != "unknown":
        final_reason = hint_reason
        confidence = 0.3
    else:
        final_reason = "unknown"
        confidence = 0.0

    # Best timestamp: from KPI peak or log finding
    best_ts = best_kpi_ts
    if not best_ts and log_findings:
        best_ts = log_findings[0][1]
    if not best_ts:
        best_ts = (t_start + t_end) // 2

    return RootCauseResult(
        component=cmdb_id,
        reason=final_reason,
        timestamp=best_ts,
        confidence=confidence,
        evidence=evidence,
    )
