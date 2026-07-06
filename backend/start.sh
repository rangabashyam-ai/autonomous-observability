#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

PYTHON="${PYTHON:-python3}"
if [[ -x /home/infobell/obs/venv/bin/python3 ]]; then
  PYTHON=/home/infobell/obs/venv/bin/python3
fi

"$PYTHON" -m pip install -q -r requirements.txt
exec env PYTHONPATH=. "$PYTHON" -m uvicorn app.main:app --host 0.0.0.0 --port 8000 "$@"
