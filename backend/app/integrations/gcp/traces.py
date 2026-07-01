"""
GCP Trace Collection — Cloud Trace.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone, timedelta

logger = logging.getLogger(__name__)


def collect_traces(credentials, project_id: str) -> list[dict]:
    """Collect recent distributed traces from Google Cloud Trace."""
    try:
        from google.cloud import trace_v1
        client = trace_v1.TraceServiceClient(credentials=credentials)
        
        now = datetime.now(timezone.utc)
        start_time = now - timedelta(minutes=5)
        
        from google.protobuf.timestamp_pb2 import Timestamp
        start_ts = Timestamp()
        start_ts.FromDatetime(start_time)
        end_ts = Timestamp()
        end_ts.FromDatetime(now)
        
        traces = []
        # Cloud Trace v1 API uses 'projects/{project_id}' for project ID
        request = {
            "project_id": project_id,
            "start_time": start_ts,
            "end_time": end_ts,
            "view": trace_v1.ListTracesRequest.ViewType.COMPLETE
        }
        
        response = client.list_traces(request=request)
        for trace in response.traces:
            traces.append({
                "trace_id": trace.trace_id,
                "project_id": trace.project_id,
                "provider": "gcp",
                "spans_count": len(trace.spans),
                "timestamp": now.isoformat() # Cloud trace typically has span times, we just return the trace record
            })
            if len(traces) >= 100:
                break
                
        logger.info(f"[GCP] Collected {len(traces)} traces")
        return traces
    except Exception as exc:
        logger.error(f"[GCP] Trace collection failed: {exc}")
        return []
