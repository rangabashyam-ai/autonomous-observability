"""
Azure Authentication — Service Principal via ClientSecretCredential.
"""

from __future__ import annotations

import logging
from typing import Optional, Tuple

logger = logging.getLogger(__name__)

# Cache: connection_id → credential object (azure-identity objects are re-usable)
_CREDENTIAL_CACHE: dict[str, object] = {}


def get_credential(connection_id: str, config: dict):
    """
    Return an azure-identity ClientSecretCredential.

    config keys:
        tenant_id: str
        client_id: str
        client_secret: str
        subscription_id: str
    """
    if connection_id in _CREDENTIAL_CACHE:
        return _CREDENTIAL_CACHE[connection_id], config.get("subscription_id", "")

    try:
        from azure.identity import ClientSecretCredential
    except ImportError:
        raise RuntimeError("azure-identity is not installed. Run: pip install azure-identity")

    tenant_id = config.get("tenant_id", "")
    client_id = config.get("client_id", "")
    client_secret = config.get("client_secret", "")
    subscription_id = config.get("subscription_id", "")

    if not all([tenant_id, client_id, client_secret, subscription_id]):
        raise ValueError("Azure connection requires tenant_id, client_id, client_secret, subscription_id")

    credential = ClientSecretCredential(
        tenant_id=tenant_id,
        client_id=client_id,
        client_secret=client_secret,
    )
    _CREDENTIAL_CACHE[connection_id] = credential
    logger.info(f"[Azure] Credential created for connection '{connection_id}'")
    return credential, subscription_id


def validate_credentials(config: dict) -> Tuple[bool, str]:
    """
    Validate Azure credentials by listing resource groups.
    Returns (success, message).
    """
    try:
        credential, subscription_id = get_credential("__validate__", config)
        from azure.mgmt.resource import ResourceManagementClient
        client = ResourceManagementClient(credential, subscription_id)
        groups = list(client.resource_groups.list())
        return True, f"Authenticated — found {len(groups)} resource group(s)"
    except ImportError:
        # azure-mgmt-resource may not always be installed; fall back to token check
        try:
            credential, _ = get_credential("__validate__", config)
            token = credential.get_token("https://management.azure.com/.default")
            return True, "Authenticated (token acquired)"
        except Exception as exc:
            return False, str(exc)
    except Exception as exc:
        return False, str(exc)
