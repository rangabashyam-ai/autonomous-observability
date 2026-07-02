"""
data_loader.py — Lazy-loading singleton for parquet telemetry data.

All heavy parquet files are loaded on first access and cached in-process.
Large files (trace_span, log_service) use predicate push-down so only
the requested time window is read from disk.
"""

from __future__ import annotations

import os
import re
from pathlib import Path
from functools import lru_cache

import pandas as pd
import pyarrow.parquet as pq

def _resolve_parquet_dir() -> Path:
    env_dir = os.environ.get("PARQUET_DIR")
    if env_dir:
        return Path(env_dir)
    # Primary: openRCA_Bank/parquet next to project root (same as parquet_store.py)
    local_path = Path(__file__).resolve().parent.parent.parent / "openRCA_Bank" / "parquet"
    if (local_path / "metric_app.parquet").exists():
        return local_path
    # Fallback: legacy data/parquet location
    return Path(__file__).resolve().parent.parent.parent / "data" / "parquet"

PARQUET_DIR = _resolve_parquet_dir()

# ── in-memory cache ──────────────────────────────────────────────────────────
_cache: dict[str, pd.DataFrame] = {}


def _load(name: str, **kw) -> pd.DataFrame:
    if name not in _cache:
        _cache[name] = pd.read_parquet(PARQUET_DIR / name, **kw)
    return _cache[name]


def metric_app() -> pd.DataFrame:
    """Load metric_app.parquet (small, ~2 MB) — all rows cached."""
    return _load("metric_app.parquet")


def metric_container() -> pd.DataFrame:
    """Load metric_container.parquet (~176 MB) — all rows cached."""
    return _load("metric_container.parquet")


def service_host_map() -> pd.DataFrame:
    """Load service_host_map.parquet (tiny) — cached."""
    return _load("service_host_map.parquet")


def trace_span_window(start_ts: int, end_ts: int) -> pd.DataFrame:
    """
    Load trace_span rows within [start_ts, end_ts] (epoch seconds).
    Uses pyarrow predicate push-down — never loads the full 4 GB file.
    """
    filters = [
        ("timestamp_s", ">=", start_ts),
        ("timestamp_s", "<=", end_ts),
    ]
    return pd.read_parquet(PARQUET_DIR / "trace_span.parquet", filters=filters)


def log_service_window(start_ts: int, end_ts: int) -> pd.DataFrame:
    """
    Load log_service rows within [start_ts, end_ts] (epoch seconds).
    Uses predicate push-down — never loads the full 1 GB file.
    """
    filters = [
        ("timestamp_s", ">=", start_ts),
        ("timestamp_s", "<=", end_ts),
    ]
    return pd.read_parquet(PARQUET_DIR / "log_service.parquet", filters=filters)


# ── KPI → reason mapping ────────────────────────────────────────────────────
# Maps kpi_name patterns to human-readable root cause reasons
# (aligned with record.csv ground truth vocabulary)

_KPI_REASON_MAP: list[tuple[re.Pattern, str]] = [
    # Network
    (re.compile(r"(?i)retrans|packet.?loss|tcp.?loss|drop", re.IGNORECASE), "network packet loss"),
    (re.compile(r"(?i)rtt|latency|delay|tcp.?time", re.IGNORECASE), "network latency"),
    # CPU
    (re.compile(r"(?i)cpu.?util|CPUCpuUtil|cpu.?usage|cpu.?load", re.IGNORECASE), "high CPU usage"),
    # Memory
    (re.compile(r"(?i)mem.?util|mem.?usage|memory|swap|heap(?!.*oom)", re.IGNORECASE), "high memory usage"),
    # Disk
    (re.compile(r"(?i)disk.?read|disk.?write|io.?read|io.?write|disk.?io", re.IGNORECASE), "high disk I/O read usage"),
    (re.compile(r"(?i)disk.?space|disk.?util|disk.?usage|fs.?usage", re.IGNORECASE), "high disk space usage"),
    # JVM
    (re.compile(r"(?i)jvm.?cpu|gc.?cpu", re.IGNORECASE), "high JVM CPU load"),
    (re.compile(r"(?i)oom|out.?of.?memory", re.IGNORECASE), "JVM Out of Memory (OOM) Heap"),
]

# Direct kpi_name substring → reason for known KPI strings in this dataset
_KPI_DIRECT_MAP: dict[str, str] = {
    # CPU
    "OSLinux-CPU_CPU_CPUCpuUtil": "high CPU usage",
    # Network — packet loss indicators
    "OSLinux-NET_NET_NETRetransSegs": "network packet loss",
    "OSLinux-NET_NET_NETRetransRate": "network packet loss",
    # Network — latency indicators
    "OSLinux-NET_NET_NETRtt": "network latency",
    # Memory
    "OSLinux-MEM_MEM_MEMMemUtil": "high memory usage",
    "OSLinux-MEM_MEM_MEMSwapUtil": "high memory usage",
    # Disk I/O
    "OSLinux-DISK_DISK_DISKReadRate": "high disk I/O read usage",
    "OSLinux-DISK_DISK_DISKWriteRate": "high disk I/O read usage",
    "OSLinux-DISK_DISK_DISKIOUtil": "high disk I/O read usage",
    # Disk space
    "OSLinux-DISK_DISK_DISKDiskUtil": "high disk space usage",
}


def kpi_to_reason(kpi_name: str) -> str:
    """Map a kpi_name string to a human-readable root cause reason."""
    # Try direct match first
    if kpi_name in _KPI_DIRECT_MAP:
        return _KPI_DIRECT_MAP[kpi_name]
    # Try regex patterns
    for pattern, reason in _KPI_REASON_MAP:
        if pattern.search(kpi_name):
            return reason
    return "unknown"


def log_to_reason(log_value: str) -> str | None:
    """Parse a log line and return a reason if it indicates a known failure."""
    if not isinstance(log_value, str):
        return None
    upper = log_value.upper()
    if "OUT OF MEMORY" in upper or "OOM" in upper or "JAVA.LANG.OUTOFMEMORYERROR" in upper:
        return "JVM Out of Memory (OOM) Heap"
    if "FULL GC" in upper:
        # Full GC is often a symptom of high memory usage
        return "high memory usage"
    return None


# ── Unique KPI names in the dataset (for discovery) ─────────────────────────

@lru_cache(maxsize=1)
def unique_kpi_names() -> list[str]:
    """Return sorted list of unique kpi_name values in metric_container."""
    mc = metric_container()
    return sorted(mc["kpi_name"].unique().tolist())
