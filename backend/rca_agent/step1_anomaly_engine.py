"""
step1_anomaly_engine.py — Metric Anomaly Engine (Symptom Detection).

Detects anomalous time windows in both application metrics (metric_app)
and infrastructure metrics (metric_container) using statistical methods:
  - Robust Z-score (MAD-based) for app metrics (mrt, sr)
  - Rolling Z-score for infrastructure KPIs
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from rca_agent import data_loader


# ── Data classes ─────────────────────────────────────────────────────────────

@dataclass
class AppAnomaly:
    """An anomaly detected in application-level metrics."""
    service: str
    timestamp: int          # epoch seconds
    mrt_zscore: float       # Z-score on mean response time (positive = spike)
    sr_zscore: float        # Z-score on success rate (negative = drop)
    mrt_value: float
    sr_value: float
    anomaly_type: str       # "mrt_spike", "sr_drop", "both"


@dataclass
class InfraAnomaly:
    """An anomaly detected in infrastructure KPIs."""
    cmdb_id: str
    kpi_name: str
    timestamp: int          # epoch seconds
    zscore: float
    value: float
    reason: str             # human-readable reason from kpi_to_reason


@dataclass
class AnomalyReport:
    """Combined output of Step 1 for a given time window."""
    app_anomalies: list[AppAnomaly] = field(default_factory=list)
    infra_anomalies: list[InfraAnomaly] = field(default_factory=list)
    incident_window_start: int = 0
    incident_window_end: int = 0


# ── Robust Z-score using MAD ────────────────────────────────────────────────

def _mad_zscore(series: pd.Series) -> pd.Series:
    """Compute Robust Z-score: 0.6745 * (x - median) / MAD."""
    med = series.median()
    mad = np.median(np.abs(series - med))
    if mad == 0:
        # fallback to std-based z-score
        std = series.std()
        if std == 0:
            return pd.Series(0.0, index=series.index)
        return (series - series.mean()) / std
    return 0.6745 * (series - med) / mad


# ── Step 1a: Application Anomaly Detection ──────────────────────────────────

def detect_app_anomalies(
    t_start: int,
    t_end: int,
    lookback: int = 3600,
    threshold: float = 3.0,
) -> list[AppAnomaly]:
    """
    Detect anomalies in metric_app within [t_start, t_end].

    Uses a lookback window to compute baseline statistics, then flags
    points in the target window where mrt or sr deviates beyond threshold.

    Args:
        t_start: Start of target window (epoch seconds).
        t_end: End of target window (epoch seconds).
        lookback: Seconds before t_start to use as baseline (default 1 hour).
        threshold: Z-score threshold for anomaly (default 3.0).

    Returns:
        List of AppAnomaly objects sorted by timestamp.
    """
    ma = data_loader.metric_app()

    # Load a wider window for baseline statistics
    baseline_start = t_start - lookback
    window = ma[(ma["timestamp_s"] >= baseline_start) & (ma["timestamp_s"] <= t_end)].copy()

    if window.empty:
        return []

    anomalies: list[AppAnomaly] = []

    for service, grp in window.groupby("service"):
        grp = grp.sort_values("timestamp_s")

        if len(grp) < 5:
            continue

        # Compute MAD Z-scores over the full baseline+target window
        mrt_z = _mad_zscore(grp["mrt"])
        sr_z = _mad_zscore(grp["sr"])

        # Only look at points inside the target window
        in_target = grp["timestamp_s"].between(t_start, t_end)

        for idx in grp[in_target].index:
            mz = float(mrt_z.loc[idx])
            sz = float(sr_z.loc[idx])
            mrt_val = float(grp.loc[idx, "mrt"])
            sr_val = float(grp.loc[idx, "sr"])
            ts = int(grp.loc[idx, "timestamp_s"])

            # mrt spike (positive z) or sr drop (negative z)
            is_mrt_spike = mz > threshold
            is_sr_drop = sz < -threshold

            if is_mrt_spike or is_sr_drop:
                if is_mrt_spike and is_sr_drop:
                    atype = "both"
                elif is_mrt_spike:
                    atype = "mrt_spike"
                else:
                    atype = "sr_drop"

                anomalies.append(AppAnomaly(
                    service=str(service),
                    timestamp=ts,
                    mrt_zscore=mz,
                    sr_zscore=sz,
                    mrt_value=mrt_val,
                    sr_value=sr_val,
                    anomaly_type=atype,
                ))

    anomalies.sort(key=lambda a: a.timestamp)
    return anomalies


# ── Step 1b: Infrastructure Anomaly Detection ───────────────────────────────

def detect_infra_anomalies(
    t_start: int,
    t_end: int,
    lookback: int = 3600,
    threshold: float = 3.0,
) -> list[InfraAnomaly]:
    """
    Detect anomalies in metric_container KPIs within [t_start, t_end].

    For each (cmdb_id, kpi_name) pair, computes Z-score over a
    lookback+target window and flags points exceeding the threshold.

    Args:
        t_start: Start of target window (epoch seconds).
        t_end: End of target window (epoch seconds).
        lookback: Seconds before t_start for baseline.
        threshold: Z-score threshold.

    Returns:
        List of InfraAnomaly objects sorted by zscore descending.
    """
    mc = data_loader.metric_container()

    baseline_start = t_start - lookback
    window = mc[
        (mc["timestamp_s"] >= baseline_start) & (mc["timestamp_s"] <= t_end)
    ].copy()

    if window.empty:
        return []

    anomalies: list[InfraAnomaly] = []

    for (cmdb_id, kpi_name), grp in window.groupby(["cmdb_id", "kpi_name"]):
        grp = grp.sort_values("timestamp_s")

        if len(grp) < 5:
            continue

        z_scores = _mad_zscore(grp["value"])
        in_target = grp["timestamp_s"].between(t_start, t_end)

        for idx in grp[in_target].index:
            z = float(z_scores.loc[idx])
            val = float(grp.loc[idx, "value"])
            ts = int(grp.loc[idx, "timestamp_s"])

            if abs(z) > threshold:
                reason = data_loader.kpi_to_reason(str(kpi_name))
                anomalies.append(InfraAnomaly(
                    cmdb_id=str(cmdb_id),
                    kpi_name=str(kpi_name),
                    timestamp=ts,
                    zscore=z,
                    value=val,
                    reason=reason,
                ))

    # Sort by absolute Z-score descending (most anomalous first)
    anomalies.sort(key=lambda a: abs(a.zscore), reverse=True)
    return anomalies


# ── Combined Step 1 ─────────────────────────────────────────────────────────

def detect_anomalies(
    t_start: int,
    t_end: int,
    lookback: int = 3600,
    threshold: float = 3.0,
) -> AnomalyReport:
    """
    Run both application and infrastructure anomaly detection.

    Returns an AnomalyReport combining both signal types.
    """
    app = detect_app_anomalies(t_start, t_end, lookback, threshold)
    infra = detect_infra_anomalies(t_start, t_end, lookback, threshold)

    return AnomalyReport(
        app_anomalies=app,
        infra_anomalies=infra,
        incident_window_start=t_start,
        incident_window_end=t_end,
    )
