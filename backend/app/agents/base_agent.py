"""Base agent for context-aware copilot."""

from __future__ import annotations

from typing import Any

from app.services.prompt_builder import build_system_prompt


class BaseAgent:
    page_type: str = ""
    role: str = "Operations Copilot"

    def get_system_prompt(self, context: dict[str, Any]) -> str:
        return build_system_prompt(self.role, context)
