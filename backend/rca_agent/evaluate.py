"""
evaluate.py — Evaluate RCA engine predictions against ground truth.

Compares predicted results (from query_runner) against the
scoring_points in query.csv.

Metrics:
  - Time accuracy: within ±1 minute of ground truth
  - Component accuracy: exact string match
  - Reason accuracy: exact string match
  - Per-task-type breakdown
  - Overall accuracy
"""

from __future__ import annotations

import csv
import logging
import os
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from pathlib import Path

log = logging.getLogger(__name__)

RESULTS_CSV = Path(
    os.environ.get(
        "RCA_OUTPUT_CSV",
        r"C:\Users\Infobell\Desktop\RCA_CORR\openRCA_Bank\rca_results.csv",
    )
)

TZ_UTC8 = timezone(timedelta(hours=8))

# ── Parsing helpers ──────────────────────────────────────────────────────────

_TIME_RE = re.compile(
    r"root cause occurrence time is within.*?of\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(?::\d{2})?)",
    re.IGNORECASE,
)

_COMPONENT_RE = re.compile(
    r"predicted root cause component is\s+(\S+)",
    re.IGNORECASE,
)

_REASON_RE = re.compile(
    r"predicted root cause reason is\s+(.+?)(?:\n|$)",
    re.IGNORECASE,
)


def _extract_times(text: str) -> list[datetime]:
    """Extract all occurrence times from a scoring/prediction string."""
    times = []
    for m in _TIME_RE.finditer(text):
        ts_str = m.group(1).strip()
        try:
            dt = datetime.strptime(ts_str, "%Y-%m-%d %H:%M:%S")
        except ValueError:
            try:
                dt = datetime.strptime(ts_str, "%Y-%m-%d %H:%M")
            except ValueError:
                continue
        dt = dt.replace(tzinfo=TZ_UTC8)
        times.append(dt)
    return times


def _extract_components(text: str) -> list[str]:
    """Extract all component names from a scoring/prediction string."""
    return [m.group(1).strip() for m in _COMPONENT_RE.finditer(text)]


def _extract_reasons(text: str) -> list[str]:
    """Extract all reason strings from a scoring/prediction string."""
    return [m.group(1).strip() for m in _REASON_RE.finditer(text)]


# ── Evaluation ───────────────────────────────────────────────────────────────

def evaluate(results_csv: Path | None = None) -> dict:
    """
    Evaluate RCA results against ground truth scoring_points.

    Returns a dict with:
      - per_task_type: {task_type: {metric: accuracy}}
      - overall: {metric: accuracy}
      - total_queries: int
      - details: list of per-query results
    """
    results_csv = results_csv or RESULTS_CSV

    if not results_csv.exists():
        log.error(f"Results CSV not found: {results_csv}")
        return {"error": "Results file not found"}

    with open(results_csv, "r", encoding="utf-8", newline="") as f:
        rows = list(csv.DictReader(f))

    details: list[dict] = []
    per_type: dict[str, dict[str, list[bool]]] = defaultdict(
        lambda: defaultdict(list)
    )

    for row in rows:
        task_type = row.get("task_type", "")
        expected = row.get("scoring_points", "")
        predicted = row.get("predicted", "")

        result: dict = {
            "task_type": task_type,
            "row_index": row.get("row_index", ""),
        }

        # ── Time comparison ──────────────────────────────────────────────
        exp_times = _extract_times(expected)
        pred_times = _extract_times(predicted)

        if exp_times:
            time_matches = []
            for et in exp_times:
                matched = any(
                    abs((et - pt).total_seconds()) <= 60
                    for pt in pred_times
                )
                time_matches.append(matched)
            result["time_correct"] = all(time_matches)
            result["time_detail"] = (
                f"expected={[t.strftime('%H:%M') for t in exp_times]}, "
                f"predicted={[t.strftime('%H:%M') for t in pred_times]}"
            )
            per_type[task_type]["time"].append(result["time_correct"])

        # ── Component comparison ─────────────────────────────────────────
        exp_components = _extract_components(expected)
        pred_components = _extract_components(predicted)

        if exp_components:
            comp_matches = []
            for ec in exp_components:
                matched = ec.lower() in [pc.lower() for pc in pred_components]
                comp_matches.append(matched)
            result["component_correct"] = all(comp_matches)
            result["component_detail"] = (
                f"expected={exp_components}, predicted={pred_components}"
            )
            per_type[task_type]["component"].append(result["component_correct"])

        # ── Reason comparison ────────────────────────────────────────────
        exp_reasons = _extract_reasons(expected)
        pred_reasons = _extract_reasons(predicted)

        if exp_reasons:
            reason_matches = []
            for er in exp_reasons:
                matched = er.lower() in [pr.lower() for pr in pred_reasons]
                reason_matches.append(matched)
            result["reason_correct"] = all(reason_matches)
            result["reason_detail"] = (
                f"expected={exp_reasons}, predicted={pred_reasons}"
            )
            per_type[task_type]["reason"].append(result["reason_correct"])

        details.append(result)

    # ── Aggregate metrics ────────────────────────────────────────────────
    per_task_summary: dict[str, dict[str, float]] = {}
    for tt, metrics in sorted(per_type.items()):
        per_task_summary[tt] = {}
        for metric, bools in metrics.items():
            if bools:
                per_task_summary[tt][f"{metric}_accuracy"] = (
                    sum(bools) / len(bools)
                )
                per_task_summary[tt][f"{metric}_count"] = len(bools)

    # Overall
    overall: dict[str, float] = {}
    for metric in ["time", "component", "reason"]:
        all_bools = []
        for tt_metrics in per_type.values():
            all_bools.extend(tt_metrics.get(metric, []))
        if all_bools:
            overall[f"{metric}_accuracy"] = sum(all_bools) / len(all_bools)
            overall[f"{metric}_correct"] = sum(all_bools)
            overall[f"{metric}_total"] = len(all_bools)

    return {
        "total_queries": len(rows),
        "per_task_type": per_task_summary,
        "overall": overall,
        "details": details,
    }


def print_report(eval_result: dict) -> None:
    """Pretty-print the evaluation report."""
    print("\n" + "=" * 70)
    print("  RCA ENGINE EVALUATION REPORT")
    print("=" * 70)

    print(f"\nTotal queries evaluated: {eval_result.get('total_queries', 0)}")

    overall = eval_result.get("overall", {})
    if overall:
        print("\n── Overall Accuracy ──")
        for metric in ["time", "component", "reason"]:
            acc = overall.get(f"{metric}_accuracy")
            correct = overall.get(f"{metric}_correct", 0)
            total = overall.get(f"{metric}_total", 0)
            if acc is not None:
                bar = "█" * int(acc * 30) + "░" * (30 - int(acc * 30))
                print(
                    f"  {metric:>12}: {bar} {acc*100:5.1f}% "
                    f"({correct:.0f}/{total:.0f})"
                )

    per_task = eval_result.get("per_task_type", {})
    if per_task:
        print("\n── Per Task Type ──")
        for tt, metrics in sorted(per_task.items()):
            parts = []
            for k, v in metrics.items():
                if k.endswith("_accuracy"):
                    name = k.replace("_accuracy", "")
                    parts.append(f"{name}={v*100:.0f}%")
            if parts:
                print(f"  {tt}: {', '.join(parts)}")

    print("\n" + "=" * 70)


# ── CLI entry point ──────────────────────────────────────────────────────────

if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )
    result = evaluate()
    print_report(result)
