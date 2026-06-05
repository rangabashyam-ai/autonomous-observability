from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent.parent / "data"


def read_json(filename: str) -> dict | list:
    filepath = DATA_DIR / filename
    if not filepath.exists():
        return {}
    import json
    with open(filepath) as f:
        return json.load(f)


def write_json(filename: str, data: dict | list) -> None:
    filepath = DATA_DIR / filename
    filepath.parent.mkdir(parents=True, exist_ok=True)
    import json
    with open(filepath, "w") as f:
        json.dump(data, f, indent=2)
