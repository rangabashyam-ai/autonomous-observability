"""Report chat agent: answers user questions about a specific RCA or incident report."""

from __future__ import annotations

_SYSTEM_PROMPT = """\
You are an SRE assistant. The user is reviewing an incident, RCA, or component report.
Answer using ONLY the facts in the provided context.

Rules (follow in order):

1. VAGUE question — broad, ambiguous, could mean many things \
(e.g. "is it okay?", "how is it doing?", "any issues?", "status?", "is it doing okay?") \
→ ask ONE short clarifying question. \
Example: "Could you be more specific — are you asking about root cause, \
a particular metric, dependency impact, or the recommended action?"

2. SPECIFIC question about the report — ANY question touching: \
root cause, where the issue originated, why it arose, why an action was prescribed, \
alerts, symptoms, components, metrics, anomalies, applied fix, suggestions, \
recommendations, post-fix incidents, similar incidents, caution level, dependency path, \
AI analysis, reasoning, or any other operational data shown in the report \
→ answer in under 70 words. Plain prose or 2–3 bullets. No markdown headers.

   Key mappings (use when the field is present in context):
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
        return {"answer": None, "error": str(exc)}
