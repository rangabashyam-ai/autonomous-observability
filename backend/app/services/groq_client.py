"""GROQ LLM client with model routing and fallback."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Robust .env loading — walks up from this file until .env is found.
# Works regardless of where uvicorn/python is launched from.
# ---------------------------------------------------------------------------
try:
    from dotenv import load_dotenv

    def _find_and_load_env() -> None:
        current = Path(__file__).resolve().parent
        for _ in range(5):
            candidate = current / ".env"
            if candidate.exists():
                load_dotenv(dotenv_path=candidate, override=False)
                return
            current = current.parent
        load_dotenv(override=False)  # last resort: let dotenv search CWD

    _find_and_load_env()
except ImportError:
    pass

try:
    import httpx  # type: ignore[import]
    _USE_HTTPX = True
except ImportError:
    import urllib.request
    import urllib.error
    _USE_HTTPX = False


def _env(key: str, default: str) -> str:
    return os.environ.get(key, default)


GROQ_BASE_URL = _env("GROQ_BASE_URL", "https://api.groq.com/openai/v1")
PRIMARY_MODEL   = _env("PRIMARY_MODEL",   "llama-3.3-70b-versatile")
SECONDARY_MODEL = _env("SECONDARY_MODEL", "llama-3.3-70b-versatile")
FAST_MODEL      = _env("FAST_MODEL",      "llama-3.3-70b-versatile")
FALLBACK_MODEL  = _env("FALLBACK_MODEL",  "llama-3.3-70b-versatile")


def _resolve_groq_base_urls() -> list[str]:
    env_url = os.environ.get("GROQ_BASE_URL", "").strip().rstrip("/")
    urls = []
    if env_url:
        urls.append(env_url)
    urls.extend([
        "https://api.groq.com/openai/v1",
        "https://api.groq.com/v1",
    ])
    return list(dict.fromkeys(urls))


def select_model(page_type: str, message_count: int) -> str:
    """Route to the appropriate model based on page type and conversation depth."""
    if message_count > 2:
        return FAST_MODEL
    if page_type in {"executive", "rca", "incident"}:
        return PRIMARY_MODEL
    return SECONDARY_MODEL


def chat_completion(
    messages: list[dict[str, str]],
    model: str,
    temperature: float = 0.2,
    response_format: dict | None = None,
    max_tokens: int = 2048,
    timeout: int = 20,
) -> dict[str, Any]:
    """Call GROQ chat completions API. Raises on failure."""
    api_key = os.environ.get("GROQ_API_KEY", "").strip()
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

    # Send the minimal required headers plus a stable User-Agent so Cloudflare does not block the request.
    # Avoid Groq-specific extra headers like HTTP-Referer and X-Title, which trigger bot protection.
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    }

    urls = _resolve_groq_base_urls()
    last_error: Exception | None = None
    for base_url in urls:
        url = f"{base_url}/chat/completions"
        if _USE_HTTPX:
            try:
                with httpx.Client(timeout=timeout) as client:
                    response = client.post(url, headers=headers, json=body)
                    response.raise_for_status()
                    return response.json()
            except httpx.HTTPStatusError as exc:
                detail = exc.response.text
                last_error = RuntimeError(f"GROQ HTTP {exc.response.status_code} @ {base_url}: {detail}")
                continue
        else:
            req = urllib.request.Request(
                url,
                data=json.dumps(body).encode("utf-8"),
                headers=headers,
                method="POST",
            )
            try:
                with urllib.request.urlopen(req, timeout=timeout) as response:
                    return json.loads(response.read().decode("utf-8"))
            except urllib.error.HTTPError as exc:
                detail = exc.read().decode("utf-8", errors="replace")
                last_error = RuntimeError(f"GROQ HTTP {exc.code} @ {base_url}: {detail}")
                continue
    if last_error is not None:
        raise last_error
    raise RuntimeError("GROQ request failed: no available endpoint could be reached.")


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