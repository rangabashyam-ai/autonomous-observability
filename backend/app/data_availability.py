"""Unified check for whether observability data is available from any source."""

from __future__ import annotations


def is_minio_intel_available() -> bool:
    try:
        from app.minio_intel_store import incidents_parquet_available

        return incidents_parquet_available()
    except Exception:
        return False


def is_vm_store_available() -> bool:
    try:
        from app import vm_data_store

        status = vm_data_store.status()
        return bool(status.get("vm_data_available"))
    except Exception:
        return False


def is_ui_data_available() -> bool:
    """True when the UI should show live data (parquet, MinIO, or VM ingest)."""
    from app import parquet_store

    if parquet_store.is_dataset_available():
        return True
    if is_minio_intel_available():
        return True
    if is_vm_store_available():
        return True
    return False


def _load_pattern_library() -> list[dict]:
    """Load RCA pattern library from JSON or parquet-backed knowledge graph."""
    from app.data_store import read_json
    from app import parquet_store

    kg = read_json("rca/knowledge_graph.json") or {}
    patterns = kg.get("pattern_library") or []
    if patterns:
        return patterns
    if parquet_store.is_dataset_available():
        kg2 = parquet_store.query("rca/knowledge_graph.json") or {}
        return kg2.get("pattern_library") or []
    return []


def is_early_detection_ready() -> bool:
    """Early detection needs pattern library + dependency edges, not just raw alerts."""
    patterns = _load_pattern_library()
    if not patterns:
        return False
    from app.data_store import read_json
    from app import parquet_store

    dep = read_json("dependencies/dependency_graph.json") or {}
    edges = dep.get("edges") or []
    if edges:
        return True
    if parquet_store.is_dataset_available():
        dep2 = parquet_store.query("dependencies/dependency_graph.json") or {}
        return bool(dep2.get("edges"))
    return False
