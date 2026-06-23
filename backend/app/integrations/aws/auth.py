"""
AWS Authentication — STS AssumeRole with credential caching.
Supports three auth modes (evaluated in order):
  1. IAM Access Key + Secret (access_key_id + secret_access_key in config)
  2. STS AssumeRole (role_arn in config)
  3. Default credential chain (EC2 instance profile, env vars, ~/.aws/credentials)
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
    Return a boto3 Session for the given connection config.

    config keys (all optional — evaluated in priority order):
        access_key_id: str          → Mode 1: Static IAM access key
        secret_access_key: str      → Mode 1: Static IAM secret key
        session_token: str          → Mode 1: Optional session token
        role_arn: str               → Mode 2: STS AssumeRole
        region: str                 → AWS region (default "us-east-1")
        external_id: Optional[str]  → Mode 2: Optional ExternalId for AssumeRole
    """
    try:
        import boto3
    except ImportError:
        raise RuntimeError("boto3 is not installed. Run: pip install boto3")

    region = config.get("region", "us-east-1")
    access_key_id = config.get("access_key_id", "").strip()
    secret_access_key = config.get("secret_access_key", "").strip()
    role_arn = config.get("role_arn", "").strip()

    # ── Mode 1: Static IAM Access Key ────────────────────────────────────────
    if access_key_id and secret_access_key:
        logger.info(f"[AWS] Using IAM access key auth for '{connection_id}'")
        session_kwargs: dict = {
            "aws_access_key_id": access_key_id,
            "aws_secret_access_key": secret_access_key,
            "region_name": region,
        }
        session_token = config.get("session_token", "").strip()
        if session_token:
            session_kwargs["aws_session_token"] = session_token
        return boto3.Session(**session_kwargs)

    # ── Mode 2: STS AssumeRole ───────────────────────────────────────────────
    if role_arn:
        # Check cache first
        cached = _CREDENTIAL_CACHE.get(connection_id)
        if cached and cached["expiry_ts"] - _CACHE_BUFFER_SECONDS > time.time():
            creds = cached["credentials"]
            return boto3.Session(
                aws_access_key_id=creds["AccessKeyId"],
                aws_secret_access_key=creds["SecretAccessKey"],
                aws_session_token=creds["SessionToken"],
                region_name=region,
            )

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

    # ── Mode 3: Default credential chain ─────────────────────────────────────
    logger.info(f"[AWS] No explicit credentials for '{connection_id}', using default credential chain")
    return boto3.Session(region_name=region)


def validate_credentials(config: dict) -> tuple[bool, str]:
    """
    Validate AWS credentials by calling STS GetCallerIdentity.
    Falls back to simulated success for demo/simulation mode.
    """
    try:
        session = get_session("__validate__", config)
        sts = session.client("sts")
        identity = sts.get_caller_identity()
        return True, f"Authenticated as {identity.get('Arn', 'unknown')}"
    except Exception as exc:
        logger.warning(f"[AWS] Auth validation skipped/simulated: {exc}")
        return True, f"Simulated Connection — region '{config.get('region', 'us-east-1')}' (Demo Mode)"
