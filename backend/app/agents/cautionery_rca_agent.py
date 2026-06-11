"""Cautionary RCA agent: checks whether a resolved incident's fix introduced new issues."""

from __future__ import annotations

from datetime import datetime, timezone

from app.agents.base_agent import BaseAgent

_SYSTEM_PROMPT = """\
You are a post-incident analyst checking whether a fix introduced regressions. Be extremely concise.

Output exactly 3 labeled lines — no extra text, no preamble:

VERDICT: <HIGH/MEDIUM/LOW> — <one sentence citing the specific evidence>
SIDE-EFFECTS: <one sentence on any post-fix anomalies, incidents, or alerts — or "None detected">
ACTION: <one concrete remediation step — e.g. "Restart auth-app to clear error backlog", "Roll back the pod scaling on settlement-app", "Drain and restart api-gateway". Never say "Investigate" — state the actual operation to perform>

Rules: use only data from the context. No invented facts. Under 60 words total.
"""


def _build_cautionary_chat_context(
    incident_id: str,
    applied_fix: str,
    dep_path: list[str],
    component_metrics: dict,
    anomalous: dict,
    post_fix: list[dict],
    path_alerts: list[dict],
    caution_level: str,
    recommendations: list[str],
    reasoning: str,
    llm_analysis: str | None,
) -> str:
    lines = [
        f"INCIDENT: {incident_id}",
        f"APPLIED_FIX: {applied_fix}",
        f"CAUTION_LEVEL: {caution_level.upper()}",
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
    if post_fix:
        pf_str = ", ".join(
            f"{i['incident_id']}({i.get('root_cause', '?')}@{i.get('service', '?')})"
            for i in post_fix[:3]
        )
        lines.append(f"POST_FIX_INCIDENTS: {pf_str}")
    if path_alerts:
        pa_str = "; ".join(
            f"{a['title']} on {a['entity_id']}" for a in path_alerts[:3]
        )
        lines.append(f"OPEN_ALERTS_ON_PATH: {pa_str}")
    if recommendations:
        lines.append(f"RECOMMENDATIONS: {'; '.join(recommendations)}")
    if reasoning:
        lines.append(f"REASONING: {reasoning}")
    if llm_analysis:
        lines.append(f"AI_ANALYSIS: {llm_analysis}")
    return "\n".join(lines)


class CautionaryRCAAgent(BaseAgent):
    page_type = "cautionary_rca"
    role = (
        "Post-Fix Cautionary Analyst. After a fix has been applied to a resolved incident, "
        "you inspect whether that fix introduced new side-effects, regressions, or risks in "
        "the dependency path. You examine the component dependency chain, current metric "
        "snapshots for each node, post-fix incident patterns on overlapping components, and "
        "open alerts on the affected service graph."
    )

    def analyze_on_click(self, incident_id: str) -> dict:
        from app.agents.incident_analysis import (
            _load_incidents,
            _load_dep_edges,
            _load_alerts,
            _trace_full_dependency_path,
            _get_metrics_snapshot,
            _detect_metric_anomalies,
            build_cautionary_context,
        )
        from app.services.groq_client import chat_completion, FAST_MODEL

        incidents  = _load_incidents()
        dep_edges  = _load_dep_edges()
        alerts     = _load_alerts()

        incident = next((i for i in incidents if i.get("incident_id") == incident_id), None)
        if not incident:
            return {"error": "Incident not found", "type": "error"}

        applied_fix  = incident.get("fix", "")
        impacted     = incident.get("impacted_components", [])
        primary      = impacted[0] if impacted else (
            incident.get("service_id") or incident.get("service", "").lower().replace(" ", "-")
        )
        resolved_at  = incident.get("resolved_at", "")

        dep_path          = _trace_full_dependency_path(primary, dep_edges)
        all_components    = list({*dep_path, *impacted})
        component_metrics = _get_metrics_snapshot(all_components)

        anomalous: dict[str, list[str]] = {
            comp: issues
            for comp, m in component_metrics.items()
            if (issues := _detect_metric_anomalies(m))
        }

        # Incidents on overlapping components started after fix
        post_fix: list[dict] = []
        if resolved_at:
            comp_set = set(all_components)
            for other in incidents:
                if other.get("incident_id") == incident_id:
                    continue
                if other.get("start_time", "") > resolved_at:
                    overlap = set(other.get("impacted_components", [])) & comp_set
                    if overlap:
                        post_fix.append({
                            "incident_id": other["incident_id"],
                            "title":       other.get("title", ""),
                            "root_cause":  other.get("root_cause", ""),
                            "service":     other.get("service", ""),
                            "start_time":  other.get("start_time", ""),
                            "overlap_components": list(overlap),
                        })

        # Open / acknowledged alerts on path
        path_alerts = [
            {
                "title":     a.get("title", ""),
                "severity":  a.get("severity", ""),
                "entity_id": a.get("entity_id", ""),
                "metric":    a.get("metric", ""),
                "value":     a.get("value"),
            }
            for a in alerts
            if a.get("status") in ("open", "acknowledged")
            and any(comp in a.get("entity_id", "") or a.get("entity_id", "") in comp for comp in all_components)
        ]

        # Caution level
        if len(post_fix) >= 3 or len(anomalous) >= 2:
            caution_level = "high"
        elif post_fix or len(anomalous) >= 1 or len(path_alerts) >= 2:
            caution_level = "medium"
        else:
            caution_level = "low"

        # Deterministic reasoning
        reasoning_parts: list[str] = [f"Fix applied: '{applied_fix}'."]
        if dep_path:
            reasoning_parts.append(f"Correlated dependency path (via metric propagation): {' → '.join(dep_path)}.")
        if post_fix:
            reasoning_parts.append(
                f"{len(post_fix)} incident(s) on overlapping components after fix: "
                f"{', '.join(i['incident_id'] for i in post_fix[:2])}."
            )
        # Include only first anomaly component
        for comp, issues in list(anomalous.items())[:1]:
            reasoning_parts.append(f"Metric anomaly on {comp}: {', '.join(issues[:2])}.")
        if path_alerts:
            reasoning_parts.append(
                f"{len(path_alerts)} open alert(s) on path: "
                f"{', '.join(a['title'] for a in path_alerts[:2])}."
            )
        if caution_level == "low":
            reasoning_parts.append("No significant side-effects detected — fix appears stable.")

        recommendations: list[str] = []
        if anomalous:
            recommendations.append(f"Monitor anomalous component(s): {', '.join(list(anomalous.keys())[:3])}")
        if post_fix:
            recommendations.append(
                f"Investigate {', '.join(i['incident_id'] for i in post_fix[:2])} for fix correlation"
            )
        if path_alerts:
            recommendations.append("Resolve open alerts on dependency path")
        if not recommendations:
            recommendations.append("No immediate action required — continue standard monitoring")

        result: dict = {
            "type": "cautionary_rca",
            "agent": self.role,
            "incident_id": incident_id,
            "applied_fix": applied_fix,
            "primary_component": primary,
            "dependency_path": dep_path,
            "component_metrics": component_metrics,
            "anomalous_components": anomalous,
            "post_fix_incidents": post_fix[:5],
            "path_alerts": path_alerts[:4],
            "caution_level": caution_level,
            "reasoning": " ".join(reasoning_parts),
            "recommendations": recommendations,
            "analysis_timestamp": datetime.now(timezone.utc).isoformat(),
        }

        # --- LLM deep analysis ---
        try:
            context_str = build_cautionary_context(
                incident, dep_path, component_metrics, anomalous, post_fix, path_alerts
            )
            resp = chat_completion(
                messages=[
                    {"role": "system", "content": _SYSTEM_PROMPT},
                    {"role": "user",   "content": f"Perform the cautionary analysis for this resolved incident:\n\n{context_str}"},
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

        result["chat_context"] = _build_cautionary_chat_context(
            incident_id=incident_id,
            applied_fix=applied_fix,
            dep_path=dep_path,
            component_metrics=component_metrics,
            anomalous=anomalous,
            post_fix=post_fix,
            path_alerts=path_alerts,
            caution_level=caution_level,
            recommendations=recommendations,
            reasoning=result["reasoning"],
            llm_analysis=result.get("llm_analysis"),
        )
        return result
