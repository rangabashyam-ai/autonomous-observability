"""
RCA Engine API router — exposes the RCA agent engine via FastAPI.

Endpoints:
  POST /api/rca/analyze   — analyze a time window
  POST /api/rca/query     — analyze a natural language query
  GET  /api/rca/evaluate  — run full evaluation against query.csv
"""

from __future__ import annotations

from datetime import datetime, timezone, timedelta
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/rca", tags=["rca-engine"])


# ── Request/Response models ──────────────────────────────────────────────────

class AnalyzeRequest(BaseModel):
    t_start: int = Field(..., description="Start of window (epoch seconds)")
    t_end: int = Field(..., description="End of window (epoch seconds)")
    num_failures: int = Field(1, description="Expected number of failures")
    use_traces: bool = Field(False, description="Enable trace analysis (slow)")
    use_llm: bool = Field(False, description="Enable LLM-enhanced reasoning")


class AnalyzeResult(BaseModel):
    timestamp: int
    component: str
    reason: str
    confidence: float
    evidence: list[str]
    datetime_utc8: str = ""
    llm_analysis: str = ""


class AnalyzeResponse(BaseModel):
    results: list[AnalyzeResult]
    window_start: int
    window_end: int
    analysis_time_ms: float = 0.0


class QueryRequest(BaseModel):
    instruction: str = Field(..., description="Natural language query")
    task_type: Optional[str] = Field(None, description="Optional task type override")
    use_llm: bool = Field(False, description="Enable LLM-enhanced reasoning")


class QueryResponse(BaseModel):
    instruction: str
    predicted: str
    results: list[AnalyzeResult]
    analysis_time_ms: float = 0.0


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/window", response_model=AnalyzeResponse)
def analyze_window(req: AnalyzeRequest):
    """Run RCA analysis on a specific time window."""
    import time
    import traceback as _tb
    from rca_agent.engine import RCAEngine

    start = time.monotonic()

    try:
        engine = RCAEngine(
            anomaly_threshold=3.0,
            lookback=3600,
            use_traces=req.use_traces,
            use_llm=req.use_llm,
        )

        rca_results = engine.analyze_window(
            req.t_start, req.t_end, req.num_failures
        )

        elapsed_ms = (time.monotonic() - start) * 1000
        tz_utc8 = timezone(timedelta(hours=8))

        return AnalyzeResponse(
            results=[
                AnalyzeResult(
                    timestamp=int(r.timestamp),
                    component=r.component,
                    reason=r.reason,
                    confidence=float(r.confidence),
                    evidence=list(r.evidence),
                    datetime_utc8=datetime.fromtimestamp(
                        int(r.timestamp), tz=tz_utc8
                    ).strftime("%Y-%m-%d %H:%M:%S") if r.timestamp else "",
                    llm_analysis=r.llm_analysis or "",
                )
                for r in rca_results
            ],
            window_start=req.t_start,
            window_end=req.t_end,
            analysis_time_ms=round(elapsed_ms, 1),
        )
    except Exception as e:
        detail = f"{type(e).__name__}: {e}\n{_tb.format_exc()}"
        raise HTTPException(status_code=500, detail=detail)


@router.post("/query", response_model=QueryResponse)
def query_rca(req: QueryRequest):
    """Run RCA from a natural language query string."""
    import time
    from rca_agent.engine import RCAEngine
    from rca_agent.query_runner import (
        _parse_time_window,
        _parse_failure_count,
        _task_needs,
        format_result,
        QueryTask,
    )

    start = time.monotonic()

    try:
        t_start, t_end = _parse_time_window(req.instruction)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Cannot parse time window: {e}")

    num_failures = _parse_failure_count(req.instruction)
    task_type = req.task_type or "task_7"  # default: ask for everything
    needs_time, needs_component, needs_reason = _task_needs(task_type)

    engine = RCAEngine(anomaly_threshold=3.0, lookback=3600, use_traces=False, use_llm=req.use_llm)

    try:
        rca_results = engine.analyze_window(t_start, t_end, num_failures)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    task = QueryTask(
        row_index=0,
        task_type=task_type,
        instruction=req.instruction,
        scoring_points="",
        t_start=t_start,
        t_end=t_end,
        num_failures=num_failures,
        needs_time=needs_time,
        needs_component=needs_component,
        needs_reason=needs_reason,
    )

    predicted = format_result(task, rca_results)
    elapsed_ms = (time.monotonic() - start) * 1000
    tz_utc8 = timezone(timedelta(hours=8))

    return QueryResponse(
        instruction=req.instruction,
        predicted=predicted,
        results=[
            AnalyzeResult(
                timestamp=r.timestamp,
                component=r.component,
                reason=r.reason,
                confidence=r.confidence,
                evidence=r.evidence,
                datetime_utc8=datetime.fromtimestamp(
                    r.timestamp, tz=tz_utc8
                ).strftime("%Y-%m-%d %H:%M:%S") if r.timestamp else "",
                llm_analysis=r.llm_analysis,
            )
            for r in rca_results
        ],
        analysis_time_ms=round(elapsed_ms, 1),
    )


@router.get("/incident-telemetry")
def get_incident_telemetry(
    t_start: int = Query(..., description="Window start epoch seconds"),
    t_end: int = Query(..., description="Window end epoch seconds"),
    entities: str = Query(default="", description="Comma-separated entity/component names"),
):
    """
    Scan metrics, logs, and traces for the given incident time window.
    Returns structured telemetry data for LLM context injection.
    """
    from app import parquet_store
    entity_list = [e.strip() for e in entities.split(",") if e.strip()]
    return parquet_store.query_incident_telemetry_by_entities(t_start, t_end, entity_list)


@router.get("/evaluate")
def evaluate_rca():
    """Run full evaluation against query.csv and return accuracy metrics."""
    from rca_agent.query_runner import run_all_queries
    from rca_agent.evaluate import evaluate

    # Run all queries first
    run_all_queries()

    # Then evaluate
    return evaluate()
