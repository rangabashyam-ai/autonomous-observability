"""Report chat agent: answers user questions about a specific RCA or incident report."""

from __future__ import annotations

_SYSTEM_PROMPT = """\
You are an SRE assistant. The user is reviewing an incident, RCA, or component report.
Answer using ONLY the facts in the provided context.

Rules (follow in order):

1. VAGUE question — a single bare word or phrase with zero operational specificity \
(e.g. "status?", "okay?", "fine?", "good?"). \
Questions that reference the component, service, API, health, metrics, performance, \
expected behaviour, working state, or any operational concept are NOT vague — \
treat them as Rule 2. \
→ Only if truly vague: ask ONE short clarifying question. \
Example: "Could you be more specific — are you asking about a particular metric, \
dependency impact, health status, or recommended action?"

2. SPECIFIC question about the report — ANY question touching: \
health, status, performance, whether something is working as expected, \
root cause, where the issue originated, why it arose, why an action was prescribed, \
alerts, symptoms, components, metrics, anomalies, applied fix, suggestions, \
recommendations, post-fix incidents, similar incidents, caution level, dependency path, \
AI analysis, reasoning, or any other operational data shown in the report \
→ answer in under 80 words. Plain prose or 2–3 bullets. No markdown headers. \
Always reference the concrete metric values and HEALTH field from the context.

   Key mappings (use when the field is present in context):
   - "working as expected?" / "status?" / "how is it doing?" → HEALTH + key METRICS (cpu, error_rate, latency) + incident_count
   - "where did it start?" / "origin?" → ORIGIN_COMPONENT from DEPENDENCY_PATH
   - "why did it arise?" / "root cause?" → ALERTS + SYMPTOMS + ROOT_CAUSE + REASONING
   - "why was this action prescribed?" → RECOMMENDATIONS + REASONING + CAUTION_LEVEL + AI_ANALYSIS

3. COMPLETELY UNRELATED question — weather, geography, sports, creative writing, \
or topics with zero connection to IT operations or this report \
→ reply exactly: "Please ask a question relevant to this report."

Never invent data not in the context.
"""


def answer_report_question(
    question: str,
    report_context: str,
    report_type: str,
    history: list[dict],
) -> dict:
    from app.services.openrouter_client import chat_completion, FAST_MODEL

    messages: list[dict] = [
        {"role": "system", "content": _SYSTEM_PROMPT},
        {
            "role": "user",
            "content": (
                f"Report type: {report_type}\n\n"
                f"--- REPORT CONTEXT ---\n{report_context}\n--- END CONTEXT ---\n\n"
                "I will now answer questions about this report."
            ),
        },
        {
            "role": "assistant",
            "content": "Understood. I have reviewed the report. What would you like to know?",
        },
    ]

    # Append last 8 turns of conversation history
    for turn in history[-8:]:
        role = turn.get("role", "user")
        content = turn.get("content", "")
        if role in ("user", "assistant") and content:
            messages.append({"role": role, "content": content})

    messages.append({"role": "user", "content": question})

    import time

    last_exc: Exception | None = None
    for attempt in range(2):
        try:
            resp = chat_completion(
                messages=messages,
                model=FAST_MODEL,
                temperature=0.2,
                max_tokens=180,
                timeout=28,
            )
            answer = resp["choices"][0]["message"]["content"]
            return {"answer": answer, "error": None}
        except Exception as exc:
            last_exc = exc
            err_str = str(exc).lower()
            # Retry once on transient rate-limit or timeout errors
            if attempt == 0 and ("429" in err_str or "timeout" in err_str or "timed out" in err_str):
                time.sleep(2)
                continue
            break

    return {"answer": None, "error": str(last_exc)}
