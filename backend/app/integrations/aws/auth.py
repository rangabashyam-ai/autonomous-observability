"""
AWS Authentication — STS AssumeRole with credential caching.
"""

from __future__ import annotations

import logging
import os
import time
from typing import Optional

logger = logging.getLogger(__name__)

# In-memory cache: connection_id → {credentials, expiry_ts}
_CREDENTIAL_CACHE: dict[str, dict] = {}
_CACHE_BUFFER_SECONDS = 300  # refresh 5 minutes before expiry


def get_session(connection_id: str, config: dict):
    """
    Return a boto3 Session authenticated via STS AssumeRole.

    config keys:
        role_arn: str
        region: str (default "us-east-1")
        external_id: Optional[str]
    """
    try:
        import boto3
    except ImportError:
        raise RuntimeError("boto3 is not installed. Run: pip install boto3")

    region = config.get("region", "us-east-1")
    role_arn = config.get("role_arn", "")

    # Check cache
    cached = _CREDENTIAL_CACHE.get(connection_id)
    if cached and cached["expiry_ts"] - _CACHE_BUFFER_SECONDS > time.time():
        creds = cached["credentials"]
        return boto3.Session(
            aws_access_key_id=creds["AccessKeyId"],
            aws_secret_access_key=creds["SecretAccessKey"],
            aws_session_token=creds["SessionToken"],
            region_name=region,
        )

    # If no role ARN (e.g., running on EC2 with instance profile), use default chain
    if not role_arn:
        logger.info(f"[AWS] No role ARN for '{connection_id}', using default credential chain")
        return boto3.Session(region_name=region)

    # AssumeRole
    sts_kwargs: dict = {
        "RoleArn": role_arn,
        "RoleSessionName": f"AutonomousOps-{connection_id[:16]}",
        "DurationSeconds": 3600,
    }
    if config.get("external_id"):
        sts_kwargs["ExternalId"] = config["external_id"]

    try:
        base_session = boto3.Session(region_name=region)
        sts = base_session.client("sts")
        response = sts.assume_role(**sts_kwargs)
        creds = response["Credentials"]

        import datetime
        expiry = creds["Expiration"]
        expiry_ts = expiry.timestamp() if hasattr(expiry, "timestamp") else time.time() + 3600

        _CREDENTIAL_CACHE[connection_id] = {
            "credentials": creds,
            "expiry_ts": expiry_ts,
        }
        logger.info(f"[AWS] Assumed role for '{connection_id}', expires {expiry}")

        return boto3.Session(
            aws_access_key_id=creds["AccessKeyId"],
            aws_secret_access_key=creds["SecretAccessKey"],
            aws_session_token=creds["SessionToken"],
            region_name=region,
        )
    except Exception as exc:
        logger.error(f"[AWS] STS AssumeRole failed for '{connection_id}': {exc}")
        raise


def validate_credentials(config: dict) -> tuple[bool, str]:
    """
    Validate AWS credentials by calling STS GetCallerIdentity.
    Returns (success, message).
    """
    try:
        import boto3
        region = config.get("region", "us-east-1")
        role_arn = config.get("role_arn", "")

        if role_arn:
            session = get_session("__validate__", config)
        else:
            session = boto3.Session(region_name=region)

        sts = session.client("sts")
        identity = sts.get_caller_identity()
        return True, f"Authenticated as {identity.get('Arn', 'unknown')}"
    except Exception as exc:
        return False, str(exc)
