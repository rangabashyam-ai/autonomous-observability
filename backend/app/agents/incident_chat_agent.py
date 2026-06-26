"""
Agentic incident chat with live telemetry tool calls, server-side conversation
memory, and dynamic time-window selection.

Protocol — the model outputs exactly one of:
  CALL: <tool_name> [window=N]   → execute tool (optional: last N minutes)
  CLARIFY: <question>            → ask user for clarification (returned as answer)
  ANSWER: <text>                 → final answer (must cite numbers from tool data)
"""

from __future__ import annotations

import re
from typing import Any

from app.parquet_store import _ts_iso

# ---------------------------------------------------------------------------
# Server-side conversation memory (per incident_id, lives for process lifetime)
# ---------------------------------------------------------------------------

class _ConversationMemory:
    """Simple per-incident conversation buffer — mimics LangChain ConversationBufferMemory."""

    def __init__(self, max_turns: int = 20):
        self._store: dict[str, list[dict]] = {}
        self._max = max_turns * 2   # user + assistant per turn

    def append(self, key: str, role: str, content: str) -> None:
        buf = self._store.setdefault(key, [])
        buf.append({"role": role, "content": content})
        self._store[key] = buf[-self._max:]

    def get(self, key: str) -> list[dict]:
        return list(self._store.get(key, []))

    def clear(self, key: str) -> None:
        self._store.pop(key, None)


_memory = _ConversationMemory()


def clear_memory(incident_id: str) -> None:
    _memory.clear(incident_id)


# ---------------------------------------------------------------------------
# Tool definitions
# ---------------------------------------------------------------------------

TOOLS: dict[str, str] = {
    "query_metrics": (
        "Returns per-minute success_rate (%), mean_response_time (ms), request_rate (req/s) "
        "for each affected service during the query window. "
        "Includes per-service min/avg/max summary. "
        "Use for: error rate, latency, throughput questions."
    ),
    "query_logs": (
        "Returns log entries from Tomcat/Apache app-tier hosts in the query window. "
        "Each entry has: timestamp, host, log_name (gc/apache_access_log/…), message, severity (error/info). "
        "Use for: exception messages, GC pressure, access errors, what the logs say."
    ),
    "query_traces": (
        "Returns distributed trace samples (trace_id, host, timestamp, parent-span flag) "
        "for affected services in the query window. "
        "Use for: trace anomalies, distributed call chains, span analysis."
    ),
    "query_host_cpu": (
        "Returns CPU % per impacted infra host during the query window (avg and peak). "
        "Use for: CPU saturation, host health, which host is hottest."
    ),
    "query_slo_burn": (
        "Returns SLO error-budget burn rates across 5m/30m/1h/2h/6h/24h windows, "
        "highest firing tier (P0-P3), time-to-budget-exhaustion. "
        "Use for: SLO, error budget, severity assessment."
    ),
}

_TOOL_LIST = "\n".join(f"  {n}: {d}" for n, d in TOOLS.items())

MAX_CALLS = 3

# ---------------------------------------------------------------------------
# System prompt
# ---------------------------------------------------------------------------

_SYSTEM = f"""\
You are an SRE assistant analyzing a specific incident. You have live telemetry tools.

TOOLS:
{_TOOL_LIST}

TIME WINDOW RULES:
- Default: use the full incident window unless the user specifies otherwise.
- If user says "last 5 minutes", "5 mins back", "last N mins", append " window=N" to CALL.
- If user says "first 10 minutes" or a specific HH:MM range, use closest available.
- Before querying for a narrow window (when user hasn't specified yet), use CLARIFY to ask.

RESPONSE RULES (output EXACTLY one per turn, nothing else):
  CALL: <tool> [window=N]   — to fetch live data; N = minutes from end of incident window
  CLARIFY: <question>       — when you need the user to specify something before proceeding
  ANSWER: <text>            — when you have enough data to answer

ANSWER FORMAT RULES (CRITICAL — always follow these):
- You MUST quote specific numbers directly from [Tool Results].
- For metrics: list each service with its actual SR%, MRT ms, RR req/s values.
- For logs: quote the actual host name, log_name, and message excerpt.
- For CPU: list each host with its actual avg% and peak% CPU.
- NEVER say "there were errors" without citing the actual error rate or log message.
- NEVER say "traces showed issues" without citing actual trace count and host names.
- If a tool returned "No data", say so explicitly — do not invent data.
- Keep answers under 150 words but include all key numbers.
"""


# ---------------------------------------------------------------------------
# Time window helpers
# ---------------------------------------------------------------------------

def _extract_window_minutes(history: list[dict]) -> int | None:
    """
    Scan recent conversation history for time-window hints from the user.
    Returns window in minutes from the END of the incident, or None.
    """
    patterns = [
        (r"(?:last|past)\s+(\d+)\s*(?:min|minute|mins|minutes)", lambda m: int(m.group(1))),
        (r"(\d+)\s*(?:min|minute|mins|minutes)\s*back",          lambda m: int(m.group(1))),
        (r"(\d+)\s*(?:min|minute|mins|minutes)\s*before",        lambda m: int(m.group(1))),
    ]
    for turn in reversed(history):
        if turn.get("role") != "user":
            continue
        text = turn.get("content", "").lower()
        for pat, extractor in patterns:
            m = re.search(pat, text)
            if m:
                return extractor(m)
    return None


def _window_bounds(meta: dict, window_minutes: int | None) -> tuple[int, int]:
    end_ts = meta["end_ts"]
    start_ts = meta["start_ts"]
    if window_minutes:
        t0 = max(end_ts - window_minutes * 60, start_ts)
        return t0, end_ts
    return start_ts, end_ts


# ---------------------------------------------------------------------------
# Rich data formatters  (include actual values the LLM must cite)
# ---------------------------------------------------------------------------

def _fmt_metrics(tel: dict) -> str:
    svc_metrics: dict[str, Any] = tel.get("service_metrics", {})
    rows = tel.get("metrics", [])
    if not svc_metrics and not rows:
        return "No metric data found in this window."

    lines = [f"Services queried: {tel.get('services', [tel.get('service')])}"]
    lines.append(f"Window: {tel['window']['start']} → {tel['window']['end']}")

    if svc_metrics:
        # Per-service summary
        for svc, m in sorted(svc_metrics.items()):
            sr = m["success_rate"]
            mrt = m["mean_response_time"]
            rr = m["request_rate"]
            lines.append(
                f"  {svc}: SR={sr['min']:.1f}%~{sr['avg']:.1f}%~{sr['max']:.1f}%  "
                f"MRT={mrt['min']:.0f}~{mrt['avg']:.0f}~{mrt['max']:.0f}ms  "
                f"RR={rr['avg']:.1f}req/s  ({m['data_points']} pts)"
            )
    else:
        # Fall back to raw rows
        for r in rows[:10]:
            lines.append(
                f"  {r.get('timestamp','')} {r.get('service','')}: "
                f"SR={r.get('success_rate',0):.1f}%  "
                f"MRT={r.get('mean_response_time',0):.0f}ms  "
                f"RR={r.get('request_rate',0):.1f}req/s"
            )
    return "\n".join(lines)


def _fmt_logs(tel: dict) -> str:
    rows = tel.get("logs", [])
    if not rows:
        return "No logs found in this window."

    errors = [r for r in rows if r.get("severity") == "error"]
    hosts = sorted({r["host"] for r in rows})
    log_types = sorted({r["log_name"] for r in rows})

    lines = [
        f"Total entries: {len(rows)}  Error entries: {len(errors)}",
        f"Hosts with logs: {hosts}",
        f"Log types: {log_types}",
    ]

    if errors:
        lines.append("Error log samples:")
        for e in errors[:8]:
            lines.append(
                f"  [{e['timestamp']}] [{e['host']}][{e['log_name']}]: {e['message'][:200]}"
            )
        if len(errors) > 8:
            lines.append(f"  ...and {len(errors) - 8} more error entries")
    else:
        lines.append("No ERROR-level log entries found (all INFO).")
        for r in rows[:4]:
            lines.append(
                f"  [{r['timestamp']}] [{r['host']}][{r['log_name']}]: {r['message'][:150]}"
            )

    return "\n".join(lines)


def _fmt_host_cpu(tel: dict) -> str:
    rows = tel.get("host_metrics", [])
    if not rows:
        return "No host CPU data in this window."

    by_host: dict[str, list[float]] = {}
    for r in rows:
        by_host.setdefault(r["host"], []).append(r["cpu"])

    lines = [f"Hosts sampled: {len(by_host)}"]
    for host, vals in sorted(by_host.items(), key=lambda x: -max(x[1])):
        avg = sum(vals) / len(vals)
        peak = max(vals)
        status = "CRITICAL" if peak > 90 else ("HIGH" if peak > 75 else "normal")
        lines.append(f"  {host}: avg={avg:.1f}%  peak={peak:.1f}%  [{status}]")

    return "\n".join(lines)


def _fmt_traces(tel: dict) -> str:
    rows = tel.get("traces", [])
    if not rows:
        return (
            "No distributed traces found in this window. "
            "The incident may be infra-layer only (no app-level traces were recorded). "
            "Check metrics and logs instead for application-level evidence."
        )

    by_host: dict[str, list] = {}
    for r in rows:
        by_host.setdefault(r["host"], []).append(r)

    lines = [f"Trace samples: {len(rows)}"]
    for host, spans in sorted(by_host.items()):
        parents = sum(1 for s in spans if s.get("has_parent"))
        lines.append(f"  {host}: {len(spans)} spans  {parents} nested/child spans")
        for s in spans[:2]:
            lines.append(f"    trace_id={s['trace_id'][:12]}  ts={s['timestamp']}")

    return "\n".join(lines)


def _fmt_slo(data: dict) -> str:
    svcs = data.get("services", [])
    if not svcs:
        return "All services within SLO budget — no burn alert is firing."

    lines = [
        f"Overall tier: {data.get('overall_highest_tier', 'none')}  "
        f"SLO target: {data.get('slo_target', 99.9)}%  "
        f"Error budget: {data.get('error_budget_minutes', '?')} min/month"
    ]
    for s in svcs[:8]:
        lines.append(
            f"  {s['service']}: burn_rate={s['max_burn_rate']:.2f}×  "
            f"tier={s.get('highest_firing_tier', '–')}  "
            f"time_to_exhaustion={s.get('time_to_exhaustion_hours', '∞')}h"
        )
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Main agentic loop
# ---------------------------------------------------------------------------

def run_incident_chat(
    incident_id: str,
    question: str,
    history: list[dict],
    incident_meta: dict,
) -> dict:
    """
    Agentic loop with server-side memory.
    Returns:
      {"answer": str, "tools_called": list[str], "error": None}
      {"answer": None, "tools_called": list[str], "error": str}
    """
    from app.services.groq_client import _post_generate
    from app.parquet_store import query_incident_telemetry, query_slo_burn_multiservice

    # -----------------------------------------------------------------
    # Merge client-sent history with server memory (server is authoritative)
    # -----------------------------------------------------------------
    server_history = _memory.get(incident_id)
    if not server_history:
        # First message — seed from client history if provided
        server_history = list(history)

    # Record this user message in memory
    _memory.append(incident_id, "user", question)
    full_history = _memory.get(incident_id)

    # -----------------------------------------------------------------
    # Time window from conversation context
    # -----------------------------------------------------------------
    window_minutes = _extract_window_minutes(full_history)
    # Use a mutable container so nested functions can update the window
    _window: list[int] = list(_window_bounds(incident_meta, window_minutes))  # [start, end]

    # -----------------------------------------------------------------
    # Tool runner (lazy-loads telemetry once per window; resets on window change)
    # -----------------------------------------------------------------
    _tel_cache: list[dict | None] = [None]

    def _telemetry() -> dict:
        if _tel_cache[0] is None:
            _tel_cache[0] = query_incident_telemetry(
                incident_meta.get("service", ""),
                incident_meta.get("impacted_components", []),
                _window[0],
                _window[1],
            )
        return _tel_cache[0]

    def _run_tool(name: str) -> str:
        try:
            if name == "query_metrics":    return _fmt_metrics(_telemetry())
            if name == "query_logs":       return _fmt_logs(_telemetry())
            if name == "query_host_cpu":   return _fmt_host_cpu(_telemetry())
            if name == "query_traces":     return _fmt_traces(_telemetry())
            if name == "query_slo_burn":
                return _fmt_slo(query_slo_burn_multiservice(_window[0], _window[1]))
            return f"Unknown tool: {name}"
        except Exception as exc:
            return f"Tool error ({name}): {exc}"

    # -----------------------------------------------------------------
    # Prompt builder
    # -----------------------------------------------------------------
    def _incident_block() -> str:
        inc = incident_meta
        inc_tw = f"{inc.get('start_time','')} → {inc.get('end_time','')}"
        query_tw = f"{_ts_iso(_window[0])} → {_ts_iso(_window[1])}"
        window_note = "" if _window[0] == inc.get("start_ts") else f"  [narrow window: {query_tw}]"
        return "\n".join([
            f"ID: {incident_id}",
            f"Title: {inc.get('title','')}",
            f"Services: {inc.get('services', [inc.get('service','')])}",
            f"Severity: {inc.get('severity','')}",
            f"Root cause context: {inc.get('root_cause','')[:300]}",
            f"Infra hosts: {inc.get('impacted_components',[])[:10]}",
            f"Incident window: {inc_tw}{window_note}",
        ])

    def _history_block() -> str:
        lines = []
        for turn in full_history[-10:]:
            role = turn.get("role", "user")
            content = (turn.get("content") or "").strip()
            if role in ("user", "assistant") and content and content != question:
                label = "User" if role == "user" else "Assistant"
                lines.append(f"{label}: {content}")
        return "\n".join(lines)

    def _build_prompt(tool_results: list[str], force_answer: bool) -> str:
        sections = [f"[System]\n{_SYSTEM}"]
        if force_answer:
            sections[0] += "\n[You have reached the tool-call limit — respond with ANSWER: now]"

        sections.append(f"[Incident]\n{_incident_block()}")

        hist = _history_block()
        if hist:
            sections.append(f"[Conversation so far]\n{hist}")

        if tool_results:
            sections.append("[Tool Results]\n" + "\n\n---\n\n".join(tool_results))

        sections.append(f"[User Question]\n{question}")
        return "\n\n".join(sections)

    # -----------------------------------------------------------------
    # Agentic loop
    # -----------------------------------------------------------------
    tool_results: list[str] = []
    tools_called: list[str] = []
    last_exc: Exception | None = None

    for iteration in range(MAX_CALLS + 1):
        force = (iteration == MAX_CALLS)
        prompt = _build_prompt(tool_results, force_answer=force)

        try:
            raw = _post_generate(prompt, max_tokens=280, temperature=0.15, timeout=50).strip()
        except Exception as exc:
            last_exc = exc
            break

        # Parse response type
        call_m    = re.search(r"CALL:\s*(\w+)(?:\s+window=(\d+))?", raw, re.IGNORECASE)
        clarify_m = re.search(r"CLARIFY:\s*([\s\S]+)", raw, re.IGNORECASE)
        answer_m  = re.search(r"ANSWER:\s*([\s\S]+)", raw, re.IGNORECASE)

        if answer_m:
            ans = answer_m.group(1).strip()
            _memory.append(incident_id, "assistant", ans)
            return {"answer": ans, "tools_called": tools_called, "error": None}

        if clarify_m and not force:
            q = clarify_m.group(1).strip()
            _memory.append(incident_id, "assistant", q)
            return {"answer": q, "tools_called": tools_called, "error": None}

        if call_m and not force:
            tool_name = call_m.group(1).strip().lower()
            override_window = int(call_m.group(2)) if call_m.group(2) else None

            # If model requests a narrower window, update and invalidate cache
            if override_window:
                new_start, new_end = _window_bounds(incident_meta, override_window)
                if new_start != _window[0] or new_end != _window[1]:
                    _window[0], _window[1] = new_start, new_end
                    _tel_cache[0] = None

            if tool_name not in TOOLS:
                break
            tools_called.append(tool_name)
            result = _run_tool(tool_name)
            tool_results.append(f"[{tool_name} results]\n{result}")
            continue

        # Model didn't follow format — treat as answer
        if raw:
            _memory.append(incident_id, "assistant", raw)
            return {"answer": raw, "tools_called": tools_called, "error": None}
        break

    err = str(last_exc) if last_exc else "No response from model."
    return {"answer": None, "tools_called": tools_called, "error": err}
