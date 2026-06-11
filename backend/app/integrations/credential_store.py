"""
Credential Store — encrypt/decrypt and persist cloud provider credentials.

Sensitive values are encrypted with a Fernet key derived from the
INTEGRATION_SECRET_KEY environment variable.  If the variable is absent, a
key is auto-generated and written to the .env file so it persists across
restarts.
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Fernet key management
# ---------------------------------------------------------------------------

def _get_or_create_fernet_key() -> bytes:
    """Return the Fernet encryption key, creating + persisting it if missing."""
    from cryptography.fernet import Fernet

    raw = os.environ.get("INTEGRATION_SECRET_KEY", "").strip()
    if raw:
        # Ensure it's valid base64-urlsafe bytes for Fernet
        try:
            return raw.encode() if len(raw) == 44 else Fernet.generate_key()
        except Exception:
            pass

    # Generate a new key and append it to the .env file
    key = Fernet.generate_key()
    env_path = Path(__file__).resolve().parent.parent.parent.parent / ".env"
    try:
        with open(env_path, "a") as f:
            f.write(f"\nINTEGRATION_SECRET_KEY={key.decode()}\n")
        os.environ["INTEGRATION_SECRET_KEY"] = key.decode()
        logger.info("Generated new INTEGRATION_SECRET_KEY and saved to .env")
    except Exception as exc:
        logger.warning(f"Could not persist INTEGRATION_SECRET_KEY to .env: {exc}")
    return key


def _fernet():
    from cryptography.fernet import Fernet
    return Fernet(_get_or_create_fernet_key())


def _encrypt(value: str) -> str:
    return _fernet().encrypt(value.encode()).decode()


def _decrypt(token: str) -> str:
    return _fernet().decrypt(token.encode()).decode()


# ---------------------------------------------------------------------------
# Sensitive field names — these will be encrypted at rest
# ---------------------------------------------------------------------------

_SENSITIVE_FIELDS = {
    "client_secret",
    "service_account_json",
    "token",
    "kubeconfig",
    "ca_cert",
    "role_arn",  # not truly secret but we encrypt for consistency
}

# ---------------------------------------------------------------------------
# Storage path
# ---------------------------------------------------------------------------

_DATA_DIR = Path(__file__).resolve().parent.parent.parent.parent.parent / "data"
_CONNECTIONS_FILE = _DATA_DIR / "integrations" / "connections.json"


def _load_raw() -> dict:
    if not _CONNECTIONS_FILE.exists():
        return {}
    try:
        with open(_CONNECTIONS_FILE) as f:
            return json.load(f)
    except Exception as exc:
        logger.error(f"Failed to load connections file: {exc}")
        return {}


def _save_raw(data: dict) -> None:
    _CONNECTIONS_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(_CONNECTIONS_FILE, "w") as f:
        json.dump(data, f, indent=2)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def save_connection(provider: str, connection_id: str, config: dict) -> None:
    """
    Persist a provider connection config.  Sensitive fields are encrypted.
    """
    data = _load_raw()
    provider_store = data.setdefault(provider, {})

    encrypted_config: dict = {}
    for k, v in config.items():
        if k in _SENSITIVE_FIELDS and isinstance(v, str) and v:
            encrypted_config[k] = _encrypt(v)
            encrypted_config[f"_enc_{k}"] = True
        elif k in _SENSITIVE_FIELDS and isinstance(v, dict):
            encrypted_config[k] = _encrypt(json.dumps(v))
            encrypted_config[f"_enc_{k}"] = True
        else:
            encrypted_config[k] = v

    provider_store[connection_id] = encrypted_config
    _save_raw(data)
    logger.info(f"Saved connection '{connection_id}' for provider '{provider}'")


def load_connection(provider: str, connection_id: str) -> Optional[dict]:
    """
    Load and decrypt a provider connection config.
    Returns None if not found.
    """
    data = _load_raw()
    stored = data.get(provider, {}).get(connection_id)
    if not stored:
        return None

    decrypted: dict = {}
    for k, v in stored.items():
        if k.startswith("_enc_"):
            continue
        enc_flag = stored.get(f"_enc_{k}", False)
        if enc_flag and isinstance(v, str):
            try:
                raw = _decrypt(v)
                # Try to deserialize JSON (e.g. service account dict)
                try:
                    decrypted[k] = json.loads(raw)
                except json.JSONDecodeError:
                    decrypted[k] = raw
            except Exception as exc:
                logger.error(f"Failed to decrypt field '{k}' for {provider}/{connection_id}: {exc}")
                decrypted[k] = v
        else:
            decrypted[k] = v
    return decrypted


def list_connections(provider: Optional[str] = None) -> list[dict]:
    """
    List all connections (metadata only, no secrets).
    """
    data = _load_raw()
    results = []
    providers = [provider] if provider else list(data.keys())
    for prov in providers:
        for conn_id, cfg in data.get(prov, {}).items():
            safe = {
                k: v for k, v in cfg.items()
                if not k.startswith("_enc_") and k not in _SENSITIVE_FIELDS
            }
            safe["connection_id"] = conn_id
            safe["provider"] = prov
            results.append(safe)
    return results


def delete_connection(provider: str, connection_id: str) -> bool:
    """Remove a connection.  Returns True if deleted, False if not found."""
    data = _load_raw()
    if connection_id in data.get(provider, {}):
        del data[provider][connection_id]
        if not data[provider]:
            del data[provider]
        _save_raw(data)
        logger.info(f"Deleted connection '{connection_id}' for provider '{provider}'")
        return True
    return False


def connection_exists(provider: str, connection_id: str) -> bool:
    data = _load_raw()
    return connection_id in data.get(provider, {})
