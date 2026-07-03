"""
engine.py — RCA Engine Orchestrator.

Ties together Steps 1–4 into a single analysis pipeline, with optional
LLM-enhanced reasoning (Step 5) using a local inference endpoint.

Given a time window and expected failure count, produces a ranked
list of RCA results: (timestamp, component, reason, confidence, evidence).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

from rca_agent import data_loader
from rca_agent.step1_anomaly_engine import (
    AnomalyReport,
    detect_anomalies,
    detect_infra_anomalies,
    InfraAnomaly,
)
from rca_agent.step2_trace_graph import build_trace_graph, TraceGraph
from rca_agent.step3_fault_localization import (
    FaultLocalizationResult,
    localize_fault,
    FaultCandidate,
)
from rca_agent.step4_root_cause_correlator import (
    RootCauseResult,
    determine_root_cause,
)

log = logging.getLogger(__name__)


@dataclass
class RCAResult:
    """A single root cause analysis result."""
    timestamp: int = 0          # epoch seconds — best estimate of root cause time
    component: str = ""         # cmdb_id of blamed component
    reason: str = ""            # human-readable root cause reason
    confidence: float = 0.0     # 0.0–1.0
    evidence: list[str] = field(default_factory=list)
    llm_analysis: str = ""      # optional LLM-generated explanation


class RCAEngine:
    """
    Main RCA engine — runs the 4-step pipeline + optional LLM refinement.

    Usage:
        engine = RCAEngine()
        results = engine.analyze_window(t_start, t_end, num_failures=1)

        # With LLM enhancement:
        engine = RCAEngine(use_llm=True)
        results = engine.analyze_window(t_start, t_end, num_failures=1)
    """

    def __init__(
        self,
        anomaly_threshold: float = 3.0,
        lookback: int = 3600,
        use_traces: bool = False,  # disabled by default — trace file is huge
        use_llm: bool = False,     # enable LLM-enhanced reasoning
    ):
        self.anomaly_threshold = anomaly_threshold
        self.lookback = lookback
        self.use_traces = use_traces
        self.use_llm = use_llm

    def analyze_window(
        self,
        t_start: int,
        t_end: int,
        num_failures: int = 1,
    ) -> list[RCAResult]:
        """
        Run the full 4-step RCA pipeline for a time window.

        Args:
            t_start: Start of incident window (epoch seconds).
            t_end: End of incident window (epoch seconds).
            num_failures: Expected number of failures in this window.

        Returns:
            List of RCAResult, one per detected failure, sorted by timestamp.
        """
        log.info(
            f"RCA Engine: analyzing window [{t_start}, {t_end}], "
            f"expecting {num_failures} failure(s)"
        )

        # ── Step 1: Anomaly Detection ────────────────────────────────────────
        anomaly_report = detect_anomalies(
            t_start, t_end,
            lookback=self.lookback,
            threshold=self.anomaly_threshold,
        )

        log.info(
            f"  Step 1: {len(anomaly_report.app_anomalies)} app anomalies, "
            f"{len(anomaly_report.infra_anomalies)} infra anomalies"
        )

        # ── Step 2: Trace Graph (optional) ───────────────────────────────────
        trace_graph: TraceGraph | None = None
        if self.use_traces:
            try:
                trace_graph = build_trace_graph(
                    t_start, t_end,
                    baseline_start=t_start - self.lookback,
                    duration_threshold=self.anomaly_threshold,
                )
                log.info(
                    f"  Step 2: {len(trace_graph.nodes)} trace nodes, "
                    f"{len(trace_graph.anomalous_cmdb_ids)} anomalous"
                )
            except Exception as e:
                log.warning(f"  Step 2: Trace analysis failed: {e}")

        # ── Step 3: Fault Localization ───────────────────────────────────────
        fault_result = localize_fault(
            anomaly_report, trace_graph, t_start, t_end
        )

        log.info(
            f"  Step 3: {len(fault_result.candidates)} candidates, "
            f"top={fault_result.blamed_component}"
        )

        # ── Step 4: Root Cause Correlation ───────────────────────────────────
        results: list[RCAResult] = []

        # Group infra anomalies by (cmdb_id, reason) to find distinct failures
        distinct_failures = self._identify_distinct_failures(
            fault_result, anomaly_report, t_start, t_end, num_failures
        )

        for cmdb_id, hint_reason, approx_ts in distinct_failures[:num_failures]:
            rca = determine_root_cause(
                cmdb_id, t_start, t_end,
                hint_reason=hint_reason,
                lookback=self.lookback,
            )

            results.append(RCAResult(
                timestamp=rca.timestamp if rca.timestamp else approx_ts,
                component=rca.component,
                reason=rca.reason,
                confidence=rca.confidence,
                evidence=[e.detail for e in rca.evidence[:5]],
            ))

        # Sort by timestamp
        results.sort(key=lambda r: r.timestamp)

        log.info(f"  Step 4: {len(results)} root cause(s) identified")
        for r in results:
            log.info(f"    → {r.component} @ {r.timestamp}: {r.reason} (conf={r.confidence:.2f})")

        # ── Step 5: LLM-Enhanced Reasoning (optional) ────────────────────────
        if self.use_llm:
            results = self._llm_refine(
                results, anomaly_report, fault_result,
                t_start, t_end, num_failures,
            )

        return results

    def _llm_refine(
        self,
        statistical_results: list[RCAResult],
        anomaly_report: AnomalyReport,
        fault_result: FaultLocalizationResult,
        t_start: int,
        t_end: int,
        num_failures: int,
    ) -> list[RCAResult]:
        """
        Use LLM to refine/validate statistical results.

        Sends the collected evidence to the LLM and merges its response
        with the statistical results.
        """
        from rca_agent.llm_client import (
            generate, build_rca_prompt, parse_rca_response, LLMError
        )

        # Build evidence strings for the prompt
        infra_evidence = [
            f"{ia.cmdb_id} | {ia.kpi_name} | z={ia.zscore:.1f} | val={ia.value:.2f} | ts={ia.timestamp} | reason={ia.reason}"
            for ia in anomaly_report.infra_anomalies[:30]
        ]

        app_evidence = [
            f"{aa.service} | mrt={aa.mrt_value:.1f}ms (z={aa.mrt_zscore:.1f}) | sr={aa.sr_value:.1f}% (z={aa.sr_zscore:.1f}) | ts={aa.timestamp} | type={aa.anomaly_type}"
            for aa in anomaly_report.app_anomalies[:15]
        ]

        # Log evidence from Step 4 results
        log_evidence = []
        for r in statistical_results:
            for e in r.evidence:
                if "Log" in e or "log" in e:
                    log_evidence.append(f"{r.component}: {e}")

        candidate_components = [c.cmdb_id for c in fault_result.candidates[:5]]

        prompt = build_rca_prompt(
            t_start, t_end, num_failures,
            infra_evidence=infra_evidence,
            app_evidence=app_evidence,
            log_evidence=log_evidence,
            candidate_components=candidate_components,
        )

        try:
            log.info("  Step 5: Calling LLM for enhanced reasoning...")
            response = generate(prompt, max_tokens=512, temperature=0.1)
            llm_results = parse_rca_response(response)

            if llm_results:
                log.info(f"  Step 5: LLM returned {len(llm_results)} result(s)")
                return self._merge_results(
                    statistical_results, llm_results, num_failures, response
                )
            else:
                log.warning("  Step 5: LLM returned no parseable results, using statistical only")
                for r in statistical_results:
                    r.llm_analysis = response  # store raw response anyway
                return statistical_results

        except LLMError as e:
            log.warning(f"  Step 5: LLM failed ({e}), using statistical results only")
            return statistical_results

    def _merge_results(
        self,
        statistical: list[RCAResult],
        llm_parsed: list[dict],
        num_failures: int,
        raw_response: str,
    ) -> list[RCAResult]:
        """
        Merge statistical and LLM results.

        Strategy: If the LLM agrees with statistical on component, boost
        confidence. If they disagree, prefer the LLM result if its
        confidence is higher (LLM has seen the full evidence context).
        """
        merged: list[RCAResult] = []

        for i in range(min(num_failures, max(len(statistical), len(llm_parsed)))):
            stat = statistical[i] if i < len(statistical) else None
            llm = llm_parsed[i] if i < len(llm_parsed) else None

            if stat and llm:
                llm_comp   = llm.get("component", "")
                llm_reason = llm.get("reason", "")
                llm_ts     = llm.get("timestamp", 0)
                llm_conf   = llm.get("confidence", 0.5)
                llm_expl   = llm.get("explanation", "")

                # Agreement boosts confidence
                if llm_comp.lower() == stat.component.lower():
                    merged.append(RCAResult(
                        timestamp=llm_ts if llm_ts else stat.timestamp,
                        component=stat.component,
                        reason=llm_reason if llm_reason else stat.reason,
                        confidence=min(1.0, (stat.confidence + llm_conf) / 2 + 0.1),
                        evidence=stat.evidence,
                        llm_analysis=llm_expl,
                    ))
                else:
                    # Disagreement: prefer LLM if it's confident
                    if llm_conf > stat.confidence and llm_comp:
                        merged.append(RCAResult(
                            timestamp=llm_ts if llm_ts else stat.timestamp,
                            component=llm_comp,
                            reason=llm_reason if llm_reason else stat.reason,
                            confidence=llm_conf,
                            evidence=stat.evidence,
                            llm_analysis=llm_expl or f"AI overrode statistical candidate ({stat.component}) based on higher confidence.",
                        ))
                    else:
                        merged.append(RCAResult(
                            timestamp=stat.timestamp,
                            component=stat.component,
                            reason=llm_reason if llm_reason else stat.reason,
                            confidence=stat.confidence,
                            evidence=stat.evidence,
                            llm_analysis=llm_expl,
                        ))
            elif stat:
                merged.append(stat)
            elif llm:
                merged.append(RCAResult(
                    timestamp=llm.get("timestamp", 0),
                    component=llm.get("component", ""),
                    reason=llm.get("reason", ""),
                    confidence=llm.get("confidence", 0.5),
                    llm_analysis=llm.get("explanation", ""),
                ))

        merged.sort(key=lambda r: r.timestamp)
        return merged

    def _identify_distinct_failures(
        self,
        fault_result: FaultLocalizationResult,
        anomaly_report: AnomalyReport,
        t_start: int,
        t_end: int,
        num_failures: int,
    ) -> list[tuple[str, str, int]]:
        """
        Identify distinct (component, reason) failure pairs.

        Returns list of (cmdb_id, hint_reason, approx_timestamp).
        """
        if not fault_result.candidates:
            return []

        # Strategy: take top candidates ensuring diversity in cmdb_id
        seen: set[str] = set()
        results: list[tuple[str, str, int]] = []

        for candidate in fault_result.candidates:
            if len(results) >= num_failures:
                break

            cid = candidate.cmdb_id

            # For multi-failure windows, allow same cmdb_id only if
            # the timestamps are sufficiently different
            key = cid
            if key in seen and num_failures <= 1:
                continue

            # Find the best timestamp for this candidate
            approx_ts = 0
            for ia in anomaly_report.infra_anomalies:
                if ia.cmdb_id == cid:
                    approx_ts = ia.timestamp
                    break

            if not approx_ts:
                approx_ts = (t_start + t_end) // 2

            results.append((cid, candidate.top_kpi_reason, approx_ts))
            seen.add(key)

        # If we still need more results, allow duplicates with different timestamps
        if len(results) < num_failures:
            for candidate in fault_result.candidates:
                if len(results) >= num_failures:
                    break

                cid = candidate.cmdb_id
                # Find all anomaly timestamps for this component
                for ia in anomaly_report.infra_anomalies:
                    if ia.cmdb_id == cid and len(results) < num_failures:
                        ts = ia.timestamp
                        # Only add if timestamp is sufficiently different from existing
                        if not any(abs(ts - r[2]) < 120 for r in results):
                            results.append((cid, ia.reason, ts))

        return results
