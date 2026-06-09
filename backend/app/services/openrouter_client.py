"""Groq LLM client with model routing and fallback."""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any


def _env(key: str, default: str) -> str:
    return os.environ.get(key, default)


GROQ_BASE_URL = _env("GROQ_BASE_URL", "https://api.groq.com/openai/v1")
PRIMARY_MODEL = _env("PRIMARY_MODEL", "llama-3.3-70b-versatile")
SECONDARY_MODEL = _env("SECONDARY_MODEL", "llama-3.1-8b-instant")
FAST_MODEL = _env("FAST_MODEL", "llama-3.1-8b-instant")
FALLBACK_MODEL = _env("FALLBACK_MODEL", "llama3-8b-8192")


def select_model(page_type: str, message_count: int) -> str:
    """Route to the appropriate model based on page type and conversation depth."""
    if message_count > 2:
        return FAST_MODEL

    primary_pages = {"executive", "rca", "incident"}
    secondary_pages = {"service", "blast"}

    if page_type in primary_pages:
        return PRIMARY_MODEL
    if page_type in secondary_pages:
        return SECONDARY_MODEL
    return SECONDARY_MODEL


def chat_completion(
    messages: list[dict[str, str]],
    model: str,
    temperature: float = 0.2,
    response_format: dict | None = None,
    max_tokens: int = 2048,
    timeout: int = 20,
) -> dict[str, Any]:
    """Call Groq chat completions API. Raises on failure."""
    api_key = os.environ.get("GROQ_API_KEY")
    if not api_key:
        raise RuntimeError("GROQ_API_KEY not configured")

    body: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    if response_format:
        body["response_format"] = response_format

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; groq-python-client/1.0)",
    }

    req = urllib.request.Request(
        f"{GROQ_BASE_URL}/chat/completions",
        data=json.dumps(body).encode("utf-8"),
        headers=headers,
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Groq HTTP {exc.code}: {detail}") from exc


def chat_with_fallback(
    messages: list[dict[str, str]],
    model: str,
    temperature: float = 0.2,
    max_tokens: int = 2048,
    timeout: int = 20,
) -> tuple[str, str]:
    """Try primary model, then fallback. Returns (content, model_used)."""
    models = [model]
    if model != FALLBACK_MODEL:
        models.append(FALLBACK_MODEL)

    last_error: Exception | None = None
    for m in models:
        try:
            result = chat_completion(messages, m, temperature, max_tokens=max_tokens, timeout=timeout)
            content = result["choices"][0]["message"]["content"]
            return content, m
        except Exception as exc:
            last_error = exc
            continue

    raise RuntimeError(f"All models failed: {last_error}")
