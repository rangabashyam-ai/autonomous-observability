"""Early failure detection — delegates to early_detection_engine."""

from app.services.early_detection_engine import analyze_early_detection, detect_early_failures_v2

__all__ = ["analyze_early_detection", "detect_early_failures_v2"]
