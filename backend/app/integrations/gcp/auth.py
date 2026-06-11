"""
GCP Authentication — Service Account credentials.
"""

from __future__ import annotations

import json
import logging
from typing import Optional, Tuple

logger = logging.getLogger(__name__)

_SCOPES = [
    "https://www.googleapis.com/auth/cloud-platform",
    "https://www.googleapis.com/auth/monitoring.read",
    "https://www.googleapis.com/auth/compute.readonly",
]

_CREDENTIAL_CACHE: dict[str, object] = {}


def get_credentials(connection_id: str, config: dict):
    """
    Return google.oauth2.service_account.Credentials.

    config keys:
        service_account_json: dict  (parsed JSON key file)
        project_id: str
    """
    if connection_id in _CREDENTIAL_CACHE:
        return _CREDENTIAL_CACHE[connection_id], config.get("project_id", "")

    try:
        from google.oauth2 import service_account
    except ImportError:
        raise RuntimeError(
            "google-auth is not installed. Run: pip install google-cloud-compute"
        )

    sa_json = config.get("service_account_json", {})
    if isinstance(sa_json, str):
        try:
            sa_json = json.loads(sa_json)
        except json.JSONDecodeError as exc:
            raise ValueError(f"Invalid service_account_json: {exc}")

    if not sa_json:
        raise ValueError("GCP connection requires service_account_json")

    credentials = service_account.Credentials.from_service_account_info(
        sa_json, scopes=_SCOPES
    )
    project_id = config.get("project_id") or sa_json.get("project_id", "")
    _CREDENTIAL_CACHE[connection_id] = credentials
    logger.info(f"[GCP] Service account credentials loaded for '{connection_id}', project='{project_id}'")
    return credentials, project_id


def validate_credentials(config: dict) -> Tuple[bool, str]:
    """
    Validate GCP credentials by fetching the project info.
    Returns (success, message).
    """
    try:
        credentials, project_id = get_credentials("__validate__", config)
        from google.cloud import resourcemanager_v3
        client = resourcemanager_v3.ProjectsClient(credentials=credentials)
        project = client.get_project(name=f"projects/{project_id}")
        return True, f"Authenticated — project '{project.display_name}' ({project_id})"
    except ImportError:
        # Fall back to a simpler token refresh check
        try:
            credentials, project_id = get_credentials("__validate__", config)
            import google.auth.transport.requests
            request = google.auth.transport.requests.Request()
            credentials.refresh(request)
            return True, f"Authenticated for project '{project_id}'"
        except Exception as exc:
            return False, str(exc)
    except Exception as exc:
        return False, str(exc)
