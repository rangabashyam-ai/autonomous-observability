"""
GCP Logs Collection — Cloud Logging.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone, timedelta

logger = logging.getLogger(__name__)


def collect_logs(credentials, project_id: str) -> list[dict]:
    """Collect recent logs from Google Cloud Logging for the project."""
    try:
        from google.cloud import logging_v2
        client = logging_v2.Client(credentials=credentials, project=project_id)
        
        # We query logs for the last 5 minutes as an example
        now = datetime.now(timezone.utc)
        start_time = (now - timedelta(minutes=5)).strftime("%Y-%m-%dT%H:%M:%SZ")
        
        filter_str = f'timestamp >= "{start_time}" AND severity >= WARNING'
        
        logs = []
        for entry in client.list_entries(filter_=filter_str, max_results=100):
            logs.append({
                "id": entry.insert_id,
                "timestamp": entry.timestamp.isoformat() if entry.timestamp else now.isoformat(),
                "severity": entry.severity or "INFO",
                "message": entry.payload if isinstance(entry.payload, str) else str(entry.payload),
                "resource_type": entry.resource.type if entry.resource else "unknown",
                "provider": "gcp",
                "project_id": project_id
            })
            
        logger.info(f"[GCP] Collected {len(logs)} logs")
        return logs
    except Exception as exc:
        logger.error(f"[GCP] Log collection failed: {exc}")
        return []
