"""
step2_trace_graph.py — Trace Graph Builder (Dependency Mapping).

Constructs a Directed Acyclic Graph (DAG) from trace_span data
during an incident window.  Identifies anomalous spans by comparing
their duration to historical averages.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from rca_agent import data_loader


@dataclass
class TraceNode:
    """A node in the trace graph (one cmdb_id / component)."""
    cmdb_id: str
    span_count: int = 0
    avg_duration: float = 0.0
    max_duration: float = 0.0
    anomalous_spans: int = 0
    duration_zscore: float = 0.0


@dataclass
class TraceEdge:
    """A directed edge parent_cmdb → child_cmdb in the trace graph."""
    parent_cmdb: str
    child_cmdb: str
    call_count: int = 0
    avg_duration: float = 0.0


@dataclass
class TraceGraph:
    """DAG of service/component call relationships during an incident window."""
    nodes: dict[str, TraceNode] = field(default_factory=dict)
    edges: list[TraceEdge] = field(default_factory=list)
    root_spans: list[str] = field(default_factory=list)  # cmdb_ids at the root
    anomalous_cmdb_ids: list[str] = field(default_factory=list)
    window_start: int = 0
    window_end: int = 0


def build_trace_graph(
    t_start: int,
    t_end: int,
    baseline_start: int | None = None,
    duration_threshold: float = 3.0,
) -> TraceGraph:
    """
    Build a trace dependency graph for the time window [t_start, t_end].

    1. Load trace spans in the window.
    2. Group by trace_id, build parent→child relationships.
    3. Aggregate by cmdb_id to create the component-level graph.
    4. Compute duration Z-scores against a baseline to flag anomalous components.

    Args:
        t_start: Window start (epoch seconds).
        t_end: Window end (epoch seconds).
        baseline_start: Start of baseline window for duration stats.
                       Defaults to t_start - 3600.
        duration_threshold: Z-score threshold for anomalous duration.

    Returns:
        TraceGraph with nodes, edges, and anomalous component IDs.
    """
    if baseline_start is None:
        baseline_start = t_start - 3600

    # Load traces for the incident window
    spans = data_loader.trace_span_window(t_start, t_end)
    if spans.empty:
        return TraceGraph(window_start=t_start, window_end=t_end)

    # Also load baseline for duration comparison
    baseline_spans = data_loader.trace_span_window(baseline_start, t_start - 1)

    # ── Compute baseline duration stats per cmdb_id ──────────────────────────
    baseline_stats: dict[str, tuple[float, float]] = {}  # cmdb_id → (mean, std)
    if not baseline_spans.empty:
        for cmdb_id, grp in baseline_spans.groupby("cmdb_id"):
            durations = grp["duration"].astype(float)
            baseline_stats[str(cmdb_id)] = (
                float(durations.mean()),
                float(durations.std()) if len(durations) > 1 else 1.0,
            )

    # ── Build component-level nodes ──────────────────────────────────────────
    nodes: dict[str, TraceNode] = {}
    for cmdb_id, grp in spans.groupby("cmdb_id"):
        cid = str(cmdb_id)
        durations = grp["duration"].astype(float)
        avg_dur = float(durations.mean())
        max_dur = float(durations.max())

        # Compute Z-score against baseline
        zscore = 0.0
        anomalous_count = 0
        if cid in baseline_stats:
            b_mean, b_std = baseline_stats[cid]
            if b_std > 0:
                zscore = (avg_dur - b_mean) / b_std
                # Count individual anomalous spans
                anomalous_count = int((durations > b_mean + duration_threshold * b_std).sum())

        nodes[cid] = TraceNode(
            cmdb_id=cid,
            span_count=len(grp),
            avg_duration=avg_dur,
            max_duration=max_dur,
            anomalous_spans=anomalous_count,
            duration_zscore=zscore,
        )

    # ── Build edges from parent-child relationships ──────────────────────────
    # Join spans with themselves to find parent→child within same trace
    edge_counts: dict[tuple[str, str], list[float]] = {}

    for trace_id, trace_grp in spans.groupby("trace_id"):
        span_to_cmdb = dict(zip(trace_grp["span_id"], trace_grp["cmdb_id"]))
        span_to_dur = dict(zip(trace_grp["span_id"], trace_grp["duration"]))

        for _, row in trace_grp.iterrows():
            parent_id = row["parent_id"]
            child_cmdb = str(row["cmdb_id"])

            if parent_id in span_to_cmdb:
                parent_cmdb = str(span_to_cmdb[parent_id])
                if parent_cmdb != child_cmdb:  # skip self-loops
                    key = (parent_cmdb, child_cmdb)
                    if key not in edge_counts:
                        edge_counts[key] = []
                    edge_counts[key].append(float(row["duration"]))

    edges = [
        TraceEdge(
            parent_cmdb=k[0],
            child_cmdb=k[1],
            call_count=len(durations),
            avg_duration=float(np.mean(durations)),
        )
        for k, durations in edge_counts.items()
    ]

    # ── Identify root spans (those whose parent_id is not in span_to_cmdb) ───
    all_span_ids = set(spans["span_id"].unique())
    root_mask = ~spans["parent_id"].isin(all_span_ids)
    root_cmdb_ids = list(spans.loc[root_mask, "cmdb_id"].unique().astype(str))

    # ── Flag anomalous components ────────────────────────────────────────────
    anomalous = [
        cid for cid, node in nodes.items()
        if node.duration_zscore > duration_threshold or node.anomalous_spans > 0
    ]

    return TraceGraph(
        nodes=nodes,
        edges=edges,
        root_spans=root_cmdb_ids,
        anomalous_cmdb_ids=anomalous,
        window_start=t_start,
        window_end=t_end,
    )


def get_downstream(graph: TraceGraph, cmdb_id: str) -> list[str]:
    """Return all downstream (child) cmdb_ids reachable from cmdb_id."""
    children: dict[str, list[str]] = {}
    for e in graph.edges:
        children.setdefault(e.parent_cmdb, []).append(e.child_cmdb)

    visited: set[str] = set()
    stack = [cmdb_id]
    while stack:
        node = stack.pop()
        if node in visited:
            continue
        visited.add(node)
        for child in children.get(node, []):
            stack.append(child)

    visited.discard(cmdb_id)
    return list(visited)


def get_upstream(graph: TraceGraph, cmdb_id: str) -> list[str]:
    """Return all upstream (parent) cmdb_ids leading to cmdb_id."""
    parents: dict[str, list[str]] = {}
    for e in graph.edges:
        parents.setdefault(e.child_cmdb, []).append(e.parent_cmdb)

    visited: set[str] = set()
    stack = [cmdb_id]
    while stack:
        node = stack.pop()
        if node in visited:
            continue
        visited.add(node)
        for parent in parents.get(node, []):
            stack.append(parent)

    visited.discard(cmdb_id)
    return list(visited)
