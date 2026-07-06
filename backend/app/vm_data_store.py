"""In-memory + JSON persistence for data pushed from the external VM.

GET handlers fall back to this store when parquet is unavailable.
VM pushes via POST /api/vm/ingest/* endpoints.
"""

from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Any

from app.data_store import DATA_DIR

_VM_DIR = DATA_DIR / "vm"
_lock = threading.Lock()
_cache: dict[str, Any] = {}

# Keys the VM can populate
INGEST_KEYS = (
    "monitoring/dashboard",
    "dependencies/graph",
    "overview",
    "early-detection",
    "ops/entities",
    "ops/sections",
    "timeseries",
    "executive/widgets",
    "service-ops/widgets",
    "platform-ops/widgets",
)


def _path(key: str) -> Path:
    safe = key.replace("/", "__")
    return _VM_DIR / f"{safe}.json"


def _load_disk() -> None:
    global _cache
    if not _VM_DIR.exists():
        return
    for f in _VM_DIR.glob("*.json"):
        try:
            key = f.stem.replace("__", "/")
            _cache[key] = json.loads(f.read_text(encoding="utf-8"))
        except Exception:
            pass


def get(key: str, default: Any = None) -> Any:
    with _lock:
        if not _cache:
            _load_disk()
        return _cache.get(key, default)


def set(key: str, payload: Any) -> dict[str, Any]:
    with _lock:
        _VM_DIR.mkdir(parents=True, exist_ok=True)
        _cache[key] = payload
        _path(key).write_text(json.dumps(payload, default=str), encoding="utf-8")
    return {"status": "accepted", "key": key}


def merge(key: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Shallow-merge dict payloads (e.g. partial dashboard update)."""
    existing = get(key) or {}
    if not isinstance(existing, dict):
        existing = {}
    merged = {**existing, **payload}
    return set(key, merged)


def append_list(key: str, items: list[Any], id_field: str = "id") -> dict[str, Any]:
    """Upsert list items by id_field."""
    existing = get(key) or []
    if not isinstance(existing, list):
        existing = []
    by_id = {str(item.get(id_field, i)): item for i, item in enumerate(existing)}
    for item in items:
        item_id = str(item.get(id_field, len(by_id)))
        by_id[item_id] = item
    return set(key, list(by_id.values()))


def status() -> dict[str, Any]:
    with _lock:
        if not _cache:
            _load_disk()
        keys = {k: True for k in _cache}
    return {
        "vm_data_available": bool(keys),
        "keys": keys,
        "ingest_endpoints": [
            "POST /api/vm/ingest/monitoring/dashboard",
            "POST /api/vm/ingest/dependencies/graph",
            "POST /api/vm/ingest/overview",
            "POST /api/vm/ingest/early-detection",
            "POST /api/vm/ingest/ops/entities",
            "POST /api/vm/ingest/ops/sections",
            "POST /api/vm/ingest/timeseries",
            "POST /api/vm/ingest/incidents",
            "POST /api/vm/ingest/alerts",
        ],
    }


def clear() -> None:
    global _cache
    with _lock:
        _cache = {}
        if _VM_DIR.exists():
            for f in _VM_DIR.glob("*.json"):
                f.unlink(missing_ok=True)
