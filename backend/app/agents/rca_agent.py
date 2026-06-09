"""RCA agent: live root cause analysis for Open / In-Progress incidents."""

from __future__ import annotations

from datetime import datetime, timezone

from app.agents.base_agent import BaseAgent

_SYSTEM_PROMPT = """\
You are an SRE performing root cause analysis. Be extremely concise.

Output exactly 2 labeled lines — no extra text, no preamble:

ROOT CAUSE: <one sentence — cite the specific metric or event that is the cause>
FIX: <one concrete remediation command or action — e.g. "Restart X", "Roll back deployment Y", "Increase memory limit on Z to N GB", "Flush cache on X". Never say "Investigate" — state the actual fix>

Rules: use only data from the context. No invented facts. Under 40 words total.
"""


def _build_rca_chat_context(
    service: str,
    alerts: list[str],
    symptoms: list[str],
    dep_path: list[str],
    component_metrics: dict,
    anomalous: dict,
    candidates: list[dict],
    suggested_fix: str,
    reasoning: str,
    llm_analysis: str | None,
) -> str:
    lines = [
        f"SERVICE: {service}",
        f"ALERTS: {', '.join(alerts) or '(none)'}",
        f"SYMPTOMS: {', '.join(symptoms) or '(none)'}",
    ]
    if dep_path:
        lines.append(f"DEPENDENCY_PATH: {' → '.join(dep_path)}")
        lines.append(f"ORIGIN_COMPONENT: {dep_path[0]}")
        lines.append(f"ENDPOINT_COMPONENT: {dep_path[-1]}")
    if anomalous:
        lines.append("ANOMALOUS_COMPONENTS:")
        for comp, issues in anomalous.items():
            m = component_metrics.get(comp, {})
            mstr = f" (cpu={m.get('cpu', 0):.1f}, err%={m.get('error_rate', 0):.1f})" if m else ""
            lines.append(f"  {comp}{mstr}: {', '.join(issues)}")
    else:
        lines.append("ANOMALOUS_COMPONENTS: none")
    if candidates:
        lines.append("ROOT_CAUSE_CANDIDATES:")
        for i, c in enumerate(candidates[:3]):
            fix = (c.get("suggested_fixes") or ["—"])[0]
            lines.append(f"  {i + 1}. {c['root_cause']} ({c['confidence']}% confidence) → {fix}")
    if suggested_fix:
        lines.append(f"SUGGESTED_FIX: {suggested_fix}")
    if reasoning:
        lines.append(f"REASONING: {reasoning}")
    if llm_analysis:
        lines.append(f"AI_ANALYSIS: {llm_analysis}")
    return "\n".join(lines)


class RCAAgent(BaseAgent):
    page_type = "rca"
    role = (
        "Root Cause Analysis Expert. You explain RCA rankings, confidence scores, "
        "signal correlation, and supporting evidence for the current analysis run only."
    )

    def analyze_on_click(self, incident_id: str) -> dict:
        from app.agents.incident_analysis import (
            _load_incidents,
            _load_dep_edges,
            _trace_full_dependency_path,
            _get_metrics_snapshot,
            _detect_metric_anomalies,
            build_rca_context,
        )
        from app.services.intelligence import analyze_rca
        from app.services.openrouter_client import chat_completion, FAST_MODEL

        incidents  = _load_incidents()
        dep_edges  = _load_dep_edges()

        incident = next((i for i in incidents if i.get("incident_id") == incident_id), None)
        if not incident:
            return {"error": "Incident not found", "type": "error"}

        impacted = incident.get("impacted_components", [])
        primary  = impacted[0] if impacted else (
            incident.get("service_id") or incident.get("service", "").lower().replace(" ", "-")
        )

        dep_path         = _trace_full_dependency_path(primary, dep_edges)
        all_components   = list({*dep_path, *impacted})
        component_metrics = _get_metrics_snapshot(all_components)

        anomalous: dict[str, list[str]] = {
            comp: issues
            for comp, m in component_metrics.items()
            if (issues := _detect_metric_anomalies(m))
        }

        alerts   = incident.get("alerts", [])
        symptoms = incident.get("symptoms", [])
        service  = incident.get("service_id") or incident.get("service", "").lower().replace(" ", "-")

        rca_result = analyze_rca(alerts, symptoms, service)
        candidates = rca_result.get("root_cause_candidates", [])[:3]

        # --- deterministic reasoning ---
        reasoning_parts: list[str] = []
        if dep_path:
            reasoning_parts.append(f"Dependency path extracted: {' → '.join(dep_path)}.")
        # Include only first anomaly component
        for comp, issues in list(anomalous.items())[:1]:
            reasoning_parts.append(f"Metric anomaly on {comp}: {', '.join(issues[:2])}.")
        if not anomalous:
            reasoning_parts.append("No metric anomalies detected on dependency path.")
        if candidates:
            top = candidates[0]
            fix = top["suggested_fixes"][0] if top.get("suggested_fixes") else "Investigate further"
            reasoning_parts.append(
                f"Top root-cause: {top['root_cause']} ({top['confidence']}% confidence, "
                f"{top['matching_incident_count']} historical match(es)). Suggested fix: {fix}."
            )
        
        suggested_fix = (
            candidates[0]["suggested_fixes"][0]
            if candidates and candidates[0].get("suggested_fixes")
            else "Investigate further"
        )

        result: dict = {
            "type": "incident_rca",
            "agent": self.role,
            "incident_id": incident_id,
            "primary_component": primary,
            "dependency_path": dep_path,
            "component_metrics": component_metrics,
            "anomalous_components": anomalous,
            "root_cause_candidates": candidates,
            "suggested_fix": suggested_fix,
            "reasoning": " ".join(reasoning_parts) or "Insufficient data for automated analysis.",
            "analysis_timestamp": datetime.now(timezone.utc).isoformat(),
        }

        # --- LLM deep analysis ---
        try:
            context_str = build_rca_context(incident, dep_path, component_metrics, anomalous, candidates)
            resp = chat_completion(
                messages=[
                    {"role": "system", "content": _SYSTEM_PROMPT},
                    {"role": "user",   "content": f"Analyse this incident and produce the RCA report:\n\n{context_str}"},
                ],
                model=FAST_MODEL,
                temperature=0.1,
                max_tokens=120,
                timeout=12,
            )
            result["llm_analysis"] = resp["choices"][0]["message"]["content"]
            result["llm_model"]    = FAST_MODEL
        except Exception as exc:
            result["llm_analysis"] = None
            result["llm_error"]    = str(exc)

        result["chat_context"] = _build_rca_chat_context(
            service=service,
            alerts=alerts,
            symptoms=symptoms,
            dep_path=dep_path,
            component_metrics=component_metrics,
            anomalous=anomalous,
            candidates=candidates,
            suggested_fix=suggested_fix,
            reasoning=result["reasoning"],
            llm_analysis=result.get("llm_analysis"),
        )
        return result

    def analyze_from_signals(
        self,
        alerts: list[str],
        symptoms: list[str],
        service: str,
        time_window_hours: int = 24,
    ) -> dict:
        """Agent analysis driven by raw signals (no incident_id required)."""
        from app.agents.incident_analysis import (
            _load_dep_edges,
            _trace_full_dependency_path,
            _get_metrics_snapshot,
            _detect_metric_anomalies,
            build_rca_signals_context,
        )
        from app.services.intelligence import analyze_rca
        from app.services.openrouter_client import chat_completion, FAST_MODEL

        dep_edges = _load_dep_edges()
        primary   = service.lower().replace(" ", "-")

        dep_path          = _trace_full_dependency_path(primary, dep_edges)
        all_components    = list({*dep_path, primary})
        component_metrics = _get_metrics_snapshot(all_components)

        anomalous: dict[str, list[str]] = {
            comp: issues
            for comp, m in component_metrics.items()
            if (issues := _detect_metric_anomalies(m))
        }

        rca_result = analyze_rca(alerts, symptoms, service, time_window_hours)
        candidates = rca_result.get("root_cause_candidates", [])[:3]

        reasoning_parts: list[str] = []
        if dep_path:
            reasoning_parts.append(f"Dependency path: {' → '.join(dep_path)}.")
        for comp, issues in list(anomalous.items())[:1]:
            reasoning_parts.append(f"Metric anomaly on {comp}: {', '.join(issues[:2])}.")
        if not anomalous:
            reasoning_parts.append("No metric anomalies on dependency path.")
        if candidates:
            top = candidates[0]
            fix = top["suggested_fixes"][0] if top.get("suggested_fixes") else "—"
            reasoning_parts.append(
                f"Top root-cause: {top['root_cause']} ({top['confidence']}% confidence). "
                f"Suggested fix: {fix}."
            )

        suggested_fix = (
            candidates[0]["suggested_fixes"][0]
            if candidates and candidates[0].get("suggested_fixes")
            else "No fix available"
        )

        result: dict = {
            "type": "incident_rca",
            "agent": self.role,
            "incident_id": "",
            "primary_component": primary,
            "dependency_path": dep_path,
            "component_metrics": component_metrics,
            "anomalous_components": anomalous,
            "root_cause_candidates": candidates,
            "suggested_fix": suggested_fix,
            "reasoning": " ".join(reasoning_parts) or "Insufficient data for automated analysis.",
            "analysis_timestamp": datetime.now(timezone.utc).isoformat(),
            "service": service,
            "alerts": alerts,
            "symptoms": symptoms,
        }

        try:
            context_str = build_rca_signals_context(
                alerts, symptoms, service, dep_path, component_metrics, anomalous, candidates
            )
            resp = chat_completion(
                messages=[
                    {"role": "system", "content": _SYSTEM_PROMPT},
                    {"role": "user",   "content": f"Analyse these signals and produce the RCA report:\n\n{context_str}"},
                ],
                model=FAST_MODEL,
                temperature=0.1,
                max_tokens=120,
                timeout=12,
            )
            result["llm_analysis"] = resp["choices"][0]["message"]["content"]
            result["llm_model"]    = FAST_MODEL
        except Exception as exc:
            result["llm_analysis"] = None
            result["llm_error"]    = str(exc)

        result["chat_context"] = _build_rca_chat_context(
            service=service,
            alerts=alerts,
            symptoms=symptoms,
            dep_path=dep_path,
            component_metrics=component_metrics,
            anomalous=anomalous,
            candidates=candidates,
            suggested_fix=suggested_fix,
            reasoning=result["reasoning"],
            llm_analysis=result.get("llm_analysis"),
        )
        return result
