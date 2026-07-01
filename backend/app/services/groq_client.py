"""
LLM client — routes all inference to a local Qwen2.5-0.5B-Instruct endpoint.

Endpoint:  POST http://192.168.3.221:8001/generate
Payload:   {"prompt": str, "max_tokens": int, "temperature": float}
Response:  {"response": str}

The server applies Qwen's chat template internally, wrapping our prompt as the
user turn.  So _messages_to_prompt embeds system instructions, history, and the
final question as structured plain text inside that single user turn.

Public interface (unchanged — all existing callers work without modification):
  chat_completion(messages, model, temperature, response_format, max_tokens, timeout) -> dict
  chat_with_fallback(messages, model, temperature, max_tokens, timeout) -> (str, str)
  select_model(page_type, message_count) -> str
  PRIMARY_MODEL, SECONDARY_MODEL, FAST_MODEL, FALLBACK_MODEL  (str constants)
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

try:
    from dotenv import load_dotenv

    def _find_and_load_env() -> None:
        current = Path(__file__).resolve().parent
        for _ in range(5):
            candidate = current / ".env"
            if candidate.exists():
                load_dotenv(dotenv_path=candidate, override=True)
                return
            current = current.parent
        load_dotenv(override=True)  # last resort: let dotenv search CWD

    _find_and_load_env()
except ImportError:
    pass

# Model name constants kept for API compatibility — not used for routing.
PRIMARY_MODEL   = "local"
SECONDARY_MODEL = "local"
FAST_MODEL      = "local"
FALLBACK_MODEL  = "local"

LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "http://192.168.3.221:8001")
LLM_GENERATE_PATH = os.environ.get("LLM_GENERATE_PATH", "/generate")

try:
    import httpx
    _USE_HTTPX = True
except ImportError:
    import urllib.request
    _USE_HTTPX = False


def select_model(page_type: str, message_count: int) -> str:
    """Kept for API compatibility — routing always resolves to the local model."""
    return "local"


# ---------------------------------------------------------------------------
# Messages → prompt conversion
# ---------------------------------------------------------------------------

def _messages_to_prompt(messages: list[dict[str, str]]) -> str:
    """
    Convert an OpenAI-style messages list into a single text block suitable
    for the Qwen2.5 server.

    The server wraps our entire prompt as the user turn in Qwen's chat
    template, so we embed all roles as labelled sections inside that one
    user message:

        [Instructions]
        <system content>

        [Conversation]
        User: ...
        Assistant: ...
        User: ...          ← last user turn (the actual question)

        Respond concisely and only based on the information above.
    """
    system_parts: list[str] = []
    history_parts: list[str] = []

    for msg in messages:
        role = msg.get("role", "user")
        content = (msg.get("content") or "").strip()
        if not content:
            continue
        if role == "system":
            system_parts.append(content)
        elif role == "user":
            history_parts.append(f"User: {content}")
        elif role == "assistant":
            history_parts.append(f"Assistant: {content}")

    sections: list[str] = []
    if system_parts:
        sections.append("[Instructions]\n" + "\n\n".join(system_parts))
    if history_parts:
        sections.append("[Conversation]\n" + "\n".join(history_parts))
    sections.append("Respond concisely and only based on the information above.")
    return "\n\n".join(sections)


# ---------------------------------------------------------------------------
# Response parsing
# ---------------------------------------------------------------------------

def _extract_text(response_json: Any) -> str:
    """
    Extract generated text from the Qwen server response shape:
      {"response": "..."}          ← primary (Qwen2.5 server)
      {"text": "..."}              ← vLLM fallback
      {"text": ["..."]}
      {"generated_text": "..."}
      {"choices": [{"text": "..."}]}
      {"choices": [{"message": {"content": "..."}}]}
    """
    if isinstance(response_json, str):
        return response_json

    if isinstance(response_json, dict):
        # Qwen2.5 server primary shape
        if "response" in response_json:
            return str(response_json["response"])

        # OpenAI chat-completions shape
        choices = response_json.get("choices")
        if choices and isinstance(choices, list) and choices:
            first = choices[0]
            if isinstance(first, dict):
                msg = first.get("message")
                if msg and isinstance(msg, dict):
                    return str(msg.get("content", ""))
                text = first.get("text", "")
                if text:
                    return str(text)

        # vLLM / generic
        text = response_json.get("text") or response_json.get("generated_text", "")
        if isinstance(text, list):
            text = text[0] if text else ""
        return str(text)

    return str(response_json)


def _wrap_as_chat_response(content: str) -> dict[str, Any]:
    """Wrap plain text in an OpenAI-compatible dict so callers need no changes."""
    return {
        "choices": [
            {
                "message": {"role": "assistant", "content": content},
                "finish_reason": "stop",
                "index": 0,
            }
        ],
        "model": "local",
    }


# ---------------------------------------------------------------------------
# Core HTTP call
# ---------------------------------------------------------------------------

def _post_generate(
    prompt: str,
    max_tokens: int = 512,
    temperature: float = 0.2,
    timeout: int = 60,
) -> str:
    """POST to /generate and return the generated text string."""
    url = f"{LLM_BASE_URL}{LLM_GENERATE_PATH}"
    payload: dict[str, Any] = {
        "prompt": prompt,
        "max_tokens": max_tokens,
        "temperature": temperature,
    }
    body_bytes = json.dumps(payload).encode("utf-8")
    headers = {"Content-Type": "application/json"}

    if _USE_HTTPX:
        with httpx.Client(timeout=timeout) as client:
            response = client.post(url, content=body_bytes, headers=headers)
            response.raise_for_status()
            return _extract_text(response.json())
    else:
        req = urllib.request.Request(url, data=body_bytes, headers=headers, method="POST")
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return _extract_text(json.loads(resp.read().decode("utf-8")))


# ---------------------------------------------------------------------------
# Public interface (same signatures as before)
# ---------------------------------------------------------------------------

def chat_completion(
    messages: list[dict[str, str]],
    model: str = "local",
    temperature: float = 0.2,
    response_format: dict | None = None,
    max_tokens: int = 512,
    timeout: int = 60,
) -> dict[str, Any]:
    """
    Drop-in replacement for the Groq chat_completion function.
    Converts messages to a prompt and calls the local /generate endpoint.
    Returns an OpenAI-compatible response dict.
    """
    prompt = _messages_to_prompt(messages)
    content = _post_generate(prompt, max_tokens=max_tokens, temperature=temperature, timeout=timeout)
    return _wrap_as_chat_response(content)


def chat_with_fallback(
    messages: list[dict[str, str]],
    model: str = "local",
    temperature: float = 0.2,
    max_tokens: int = 512,
    timeout: int = 60,
) -> tuple[str, str]:
    """
    Drop-in replacement for chat_with_fallback.
    Returns (generated_content, model_used).
    """
    prompt = _messages_to_prompt(messages)
    content = _post_generate(prompt, max_tokens=max_tokens, temperature=temperature, timeout=timeout)
    return content, "local"


    raise RuntimeError(f"All models failed: {last_error}")

# End of file - Trigger reload on change
