"""Report chat agent: answers user questions about a specific RCA or incident report."""

from __future__ import annotations

_SYSTEM_PROMPT = """\
You are an SRE assistant. You have been given an incident report with telemetry data.
Answer the user's question using ONLY the facts in the provided report context.
Do not invent numbers, service names, or findings not present in the data.

Rules:
- If the question is vague (single word, no IT context): ask one short clarifying question.
- If the question is about this incident (health, root cause, metrics, logs, traces, fix, impact): answer in plain prose or 2-4 short bullets, under 120 words, using specific numbers from the context.
- If the question is completely unrelated to IT operations: reply "Please ask a question relevant to this incident."

When answering root-cause or summary questions, combine: degraded services (low success_rate), high-CPU hosts, log error hosts, and slow trace spans into one concise narrative.
"""


def answer_report_question(
    question: str,
    report_context: str,
    report_type: str,
    history: list[dict],
) -> dict:
    from app.services.groq_client import chat_completion, FAST_MODEL

    # Build the user turn that carries all context.
    # The Qwen server wraps this as the user message in its chat template,
    # so we embed system instructions, report data, history, and the question here.
    context_block = (
        f"[Instructions]\n{_SYSTEM_PROMPT}\n\n"
        f"[Report Type]\n{report_type}\n\n"
        f"[Report Context]\n{report_context}\n\n"
    )

    # Append last 6 turns of conversation history
    history_lines: list[str] = []
    for turn in history[-6:]:
        role = turn.get("role", "user")
        content = (turn.get("content") or "").strip()
        if role in ("user", "assistant") and content:
            history_lines.append(f"{'User' if role == 'user' else 'Assistant'}: {content}")

    if history_lines:
        context_block += "[Previous conversation]\n" + "\n".join(history_lines) + "\n\n"

    context_block += f"[Question]\n{question}\n\nAnswer:"

    messages: list[dict] = [
        {"role": "user", "content": context_block},
    ]

    import time

    last_exc: Exception | None = None
    for attempt in range(2):
        try:
            resp = chat_completion(
                messages=messages,
                model=FAST_MODEL,
                temperature=0.3,
                max_tokens=300,
                timeout=45,
            )
            answer = (resp["choices"][0]["message"]["content"] or "").strip()
            if not answer:
                return {"answer": None, "error": "The model returned an empty response."}
            return {"answer": answer, "error": None}
        except Exception as exc:
            last_exc = exc
            err_str = str(exc).lower()
            if attempt == 0 and ("429" in err_str or "timeout" in err_str or "timed out" in err_str):
                time.sleep(2)
                continue
            break

    return {"answer": None, "error": str(last_exc)}
