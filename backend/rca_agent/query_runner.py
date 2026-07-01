"""
query_runner.py — Parse and run all RCA queries from query.csv.

Reads query.csv, parses each row to extract the time window, number
of failures, and what fields are requested (time, component, reason).
Calls the RCAEngine for each query and produces a results CSV.

Task type mapping (from query.csv task_index):
  task_1 → occurrence time only
  task_2 → reason only
  task_3 → component only
  task_4 → time + reason
  task_5 → time + component
  task_6 → component + reason
  task_7 → time + component + reason
"""

from __future__ import annotations

import csv
import logging
import os
import re
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone, timedelta
from pathlib import Path

from rca_agent.engine import RCAEngine, RCAResult

log = logging.getLogger(__name__)

QUERY_CSV = Path(
    os.environ.get(
        "QUERY_CSV",
        r"C:\Users\Infobell\Desktop\RCA_CORR\openRCA_Bank\query.csv",
    )
)

OUTPUT_CSV = Path(
    os.environ.get(
        "RCA_OUTPUT_CSV",
        r"C:\Users\Infobell\Desktop\RCA_CORR\openRCA_Bank\rca_results.csv",
    )
)

# UTC+8 timezone (Asia/Shanghai — the timezone of the data)
TZ_UTC8 = timezone(timedelta(hours=8))


@dataclass
class QueryTask:
    """Parsed query from query.csv."""
    row_index: int
    task_type: str           # task_1 through task_7
    instruction: str
    scoring_points: str
    t_start: int             # epoch seconds (UTC)
    t_end: int               # epoch seconds (UTC)
    num_failures: int
    needs_time: bool
    needs_component: bool
    needs_reason: bool


# ── Parsing helpers ──────────────────────────────────────────────────────────

_MONTH_MAP = {
    "january": 1, "february": 2, "march": 3, "april": 4,
    "may": 5, "june": 6, "july": 7, "august": 8,
    "september": 9, "october": 10, "november": 11, "december": 12,
}

# Pattern: "March 4, 2021, from 14:30 to 15:00"
# or: "March 6, 2021, from 23:30 to March 7, 2021, at 00:00"
_TIME_PATTERN = re.compile(
    r"(\w+)\s+(\d{1,2}),\s*(\d{4}),?\s*(?:from|between|within the time range of)?\s*"
    r"(\d{1,2}:\d{2})\s*to\s*"
    r"(?:(\w+)\s+(\d{1,2}),\s*(\d{4}),?\s*(?:at\s*)?)?(\d{1,2}:\d{2})",
    re.IGNORECASE,
)

# Alternative pattern for "during the time range of March 6, 2021, from 23:30 to March 7, 2021, at 00:00"
_TIME_PATTERN2 = re.compile(
    r"(?:time\s+range\s+of\s+)?(\w+)\s+(\d{1,2}),\s*(\d{4}),?\s*"
    r"(?:from\s+)?(\d{1,2}:\d{2})\s*(?:to|through)\s*"
    r"(?:(\w+)\s+(\d{1,2}),\s*(\d{4}),?\s*(?:at\s*)?)?(\d{1,2}:\d{2})",
    re.IGNORECASE,
)

# Third pattern: "On March 4, 2021, between 18:00 and 18:30"
# Also: "during the time range from/of 00:00 to 00:30"
# Also: "within the time range from 06:30 to 07:00"
# Also: "between the time range of 04:30 to 05:00"
_TIME_PATTERN3 = re.compile(
    r"(\w+)\s+(\d{1,2}),\s*(\d{4}),?\s*"
    r"(?:between\s+the\s+time\s+range\s+of|during\s+the\s+time\s+range\s+of|"
    r"during\s+the\s+time\s+range\s+from|within\s+the\s+time\s+range\s+from|"
    r"between|from)?\s*"
    r"(\d{1,2}:\d{2})\s*(?:and|to)\s*(\d{1,2}:\d{2})",
    re.IGNORECASE,
)


_FAILURE_COUNT = re.compile(
    r"(?:were\s+)?(\w+)\s+(?:failures?|failure\s+event)", re.IGNORECASE
)

_WORD_TO_NUM = {
    "one": 1, "a": 1, "single": 1, "two": 2, "three": 3,
    "four": 4, "five": 5,
}


def _parse_time_window(instruction: str) -> tuple[int, int]:
    """Extract (t_start, t_end) as epoch seconds from the instruction text."""

    m = _TIME_PATTERN.search(instruction)
    if not m:
        m = _TIME_PATTERN2.search(instruction)

    if m:
        month1 = _MONTH_MAP.get(m.group(1).lower(), 3)
        day1 = int(m.group(2))
        year1 = int(m.group(3))
        time1 = m.group(4)

        # End date may be different from start date
        if m.group(5) and m.group(6) and m.group(7):
            month2 = _MONTH_MAP.get(m.group(5).lower(), month1)
            day2 = int(m.group(6))
            year2 = int(m.group(7))
        else:
            month2, day2, year2 = month1, day1, year1

        time2 = m.group(8)

        h1, min1 = map(int, time1.split(":"))
        h2, min2 = map(int, time2.split(":"))

        dt_start = datetime(year1, month1, day1, h1, min1, tzinfo=TZ_UTC8)
        dt_end = datetime(year2, month2, day2, h2, min2, tzinfo=TZ_UTC8)

        return int(dt_start.timestamp()), int(dt_end.timestamp())

    # Fallback: simpler pattern (5 groups, same-day only)
    m3 = _TIME_PATTERN3.search(instruction)
    if m3:
        month1 = _MONTH_MAP.get(m3.group(1).lower(), 3)
        day1 = int(m3.group(2))
        year1 = int(m3.group(3))
        time1 = m3.group(4)
        time2 = m3.group(5)

        h1, min1 = map(int, time1.split(":"))
        h2, min2 = map(int, time2.split(":"))

        dt_start = datetime(year1, month1, day1, h1, min1, tzinfo=TZ_UTC8)
        dt_end = datetime(year1, month1, day1, h2, min2, tzinfo=TZ_UTC8)

        return int(dt_start.timestamp()), int(dt_end.timestamp())

    raise ValueError(f"Cannot parse time window from: {instruction[:100]}")


def _parse_failure_count(instruction: str) -> int:
    """Extract the number of failures from the instruction text."""
    m = _FAILURE_COUNT.search(instruction)
    if m:
        word = m.group(1).lower()
        if word in _WORD_TO_NUM:
            return _WORD_TO_NUM[word]
        try:
            return int(word)
        except ValueError:
            pass
    return 1


def _task_needs(task_type: str) -> tuple[bool, bool, bool]:
    """Return (needs_time, needs_component, needs_reason) for a task type."""
    return {
        "task_1": (True, False, False),
        "task_2": (False, False, True),
        "task_3": (False, True, False),
        "task_4": (True, False, True),
        "task_5": (True, True, False),
        "task_6": (False, True, True),
        "task_7": (True, True, True),
    }.get(task_type, (True, True, True))


def parse_queries(csv_path: Path | None = None) -> list[QueryTask]:
    """Parse all queries from query.csv."""
    csv_path = csv_path or QUERY_CSV

    tasks: list[QueryTask] = []

    with open(csv_path, "r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        for i, row in enumerate(reader):
            task_type = row.get("task_index", "").strip()
            instruction = row.get("instruction", "").strip()
            scoring = row.get("scoring_points", "").strip()

            if not task_type or not instruction:
                continue

            try:
                t_start, t_end = _parse_time_window(instruction)
            except ValueError as e:
                log.warning(f"Row {i}: {e}")
                continue

            num_failures = _parse_failure_count(instruction)
            needs_time, needs_component, needs_reason = _task_needs(task_type)

            tasks.append(QueryTask(
                row_index=i,
                task_type=task_type,
                instruction=instruction,
                scoring_points=scoring,
                t_start=t_start,
                t_end=t_end,
                num_failures=num_failures,
                needs_time=needs_time,
                needs_component=needs_component,
                needs_reason=needs_reason,
            ))

    return tasks


def format_result(
    task: QueryTask,
    results: list[RCAResult],
) -> str:
    """Format RCA results to match the scoring_points format."""
    lines: list[str] = []

    if len(results) == 0:
        return "No root cause identified"

    for i, r in enumerate(results):
        prefix = "The only" if len(results) == 1 else f"The {i+1}-th"

        if task.needs_time and r.timestamp:
            dt = datetime.fromtimestamp(r.timestamp, tz=TZ_UTC8)
            time_str = dt.strftime("%Y-%m-%d %H:%M:%S")
            lines.append(
                f"{prefix} root cause occurrence time is within 1 minutes "
                f"(i.e., <=1min) of {time_str}"
            )

        if task.needs_component and r.component:
            lines.append(
                f"{prefix} predicted root cause component is {r.component}"
            )

        if task.needs_reason and r.reason:
            lines.append(
                f"{prefix} predicted root cause reason is {r.reason}"
            )

    return "\n".join(lines)


def run_all_queries(
    csv_path: Path | None = None,
    output_path: Path | None = None,
) -> list[dict]:
    """
    Run all queries from query.csv through the RCA engine.

    Returns list of dicts with columns:
      row_index, task_type, instruction, scoring_points,
      predicted, num_results, confidence
    """
    csv_path = csv_path or QUERY_CSV
    output_path = output_path or OUTPUT_CSV

    tasks = parse_queries(csv_path)
    engine = RCAEngine(anomaly_threshold=3.0, lookback=3600, use_traces=False)

    all_results: list[dict] = []

    for i, task in enumerate(tasks):
        log.info(f"\n{'='*60}")
        log.info(f"Query {i+1}/{len(tasks)}: {task.task_type} [{task.instruction[:80]}...]")

        try:
            rca_results = engine.analyze_window(
                task.t_start, task.t_end,
                num_failures=task.num_failures,
            )
        except Exception as e:
            log.error(f"  Engine error: {e}")
            rca_results = []

        predicted = format_result(task, rca_results)
        avg_conf = (
            sum(r.confidence for r in rca_results) / len(rca_results)
            if rca_results else 0.0
        )

        all_results.append({
            "row_index": task.row_index,
            "task_type": task.task_type,
            "instruction": task.instruction[:200],
            "scoring_points": task.scoring_points,
            "predicted": predicted,
            "num_results": len(rca_results),
            "confidence": round(avg_conf, 3),
        })

        log.info(f"  Expected: {task.scoring_points[:120]}")
        log.info(f"  Predicted: {predicted[:120]}")

    # Write results CSV
    if all_results:
        with open(output_path, "w", encoding="utf-8", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=all_results[0].keys())
            writer.writeheader()
            writer.writerows(all_results)
        log.info(f"\nResults written to {output_path}")

    return all_results


# ── CLI entry point ──────────────────────────────────────────────────────────

if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )
    results = run_all_queries()
    print(f"\nProcessed {len(results)} queries. Results saved to {OUTPUT_CSV}")
