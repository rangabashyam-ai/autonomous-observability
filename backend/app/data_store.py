import os
from pathlib import Path

DATA_DIR = Path(
    os.environ.get(
        "DATA_DIR",
        str(Path(__file__).resolve().parent.parent.parent / "data"),
    )
)


def read_json(filename: str) -> dict | list:
    # Prefer parquet if dataset is available and path is routed
    try:
        from . import parquet_store
        if parquet_store.is_dataset_available() and filename in parquet_store._ROUTES:
            res = parquet_store.query(filename)
            if res:
                return res
    except Exception:
        pass

    filepath = DATA_DIR / filename
    if filepath.exists():
        import json
        with open(filepath) as f:
            return json.load(f)
    # JSON file absent — query parquet directly
    try:
        from . import parquet_store
        return parquet_store.query(filename)
    except Exception:
        return {}


def write_json(filename: str, data: dict | list) -> None:
    filepath = DATA_DIR / filename
    filepath.parent.mkdir(parents=True, exist_ok=True)
    import json
    with open(filepath, "w") as f:
        json.dump(data, f, indent=2)
