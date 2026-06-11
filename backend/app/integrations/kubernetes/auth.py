"""
Kubernetes Authentication — kubeconfig or endpoint+token.
"""

from __future__ import annotations

import base64
import logging
import tempfile
import os
from typing import Optional, Tuple

logger = logging.getLogger(__name__)

_CLIENT_CACHE: dict[str, object] = {}


def get_client(connection_id: str, config: dict):
    """
    Return a configured kubernetes.client.ApiClient.

    config keys (one of two modes):
        Mode A — kubeconfig:
            kubeconfig: str  (base64-encoded kubeconfig YAML)
        Mode B — endpoint + token:
            endpoint: str    (e.g., "https://1.2.3.4:6443")
            token: str       (Bearer token)
            ca_cert: str     (optional, base64-encoded CA certificate PEM)
    """
    if connection_id in _CLIENT_CACHE:
        return _CLIENT_CACHE[connection_id]

    try:
        from kubernetes import client as k8s_client, config as k8s_config
    except ImportError:
        raise RuntimeError("kubernetes is not installed. Run: pip install kubernetes")

    kubeconfig_b64 = config.get("kubeconfig", "")
    endpoint = config.get("endpoint", "")
    token = config.get("token", "")
    ca_cert_b64 = config.get("ca_cert", "")

    if kubeconfig_b64:
        # Decode and write to a temp file, then load
        try:
            kubeconfig_yaml = base64.b64decode(kubeconfig_b64).decode()
        except Exception:
            kubeconfig_yaml = kubeconfig_b64  # already plain text

        with tempfile.NamedTemporaryFile(mode="w", suffix=".yaml", delete=False) as f:
            f.write(kubeconfig_yaml)
            tmp_path = f.name

        try:
            k8s_config.load_kube_config(config_file=tmp_path)
            api_client = k8s_client.ApiClient()
        finally:
            os.unlink(tmp_path)

    elif endpoint and token:
        configuration = k8s_client.Configuration()
        configuration.host = endpoint
        configuration.api_key = {"authorization": f"Bearer {token}"}
        configuration.api_key_prefix = {"authorization": "Bearer"}

        if ca_cert_b64:
            try:
                ca_pem = base64.b64decode(ca_cert_b64)
            except Exception:
                ca_pem = ca_cert_b64.encode()
            with tempfile.NamedTemporaryFile(suffix=".pem", delete=False) as f:
                f.write(ca_pem)
                configuration.ssl_ca_cert = f.name
        else:
            configuration.verify_ssl = False

        api_client = k8s_client.ApiClient(configuration)
    else:
        # Fallback: try in-cluster config (when running inside a pod)
        try:
            k8s_config.load_incluster_config()
            api_client = k8s_client.ApiClient()
        except Exception:
            raise ValueError("Kubernetes connection requires either kubeconfig or endpoint+token")

    _CLIENT_CACHE[connection_id] = api_client
    logger.info(f"[K8s] API client configured for connection '{connection_id}'")
    return api_client


def validate_credentials(config: dict) -> Tuple[bool, str]:
    """
    Validate Kubernetes credentials by listing namespaces.
    Returns (success, message).
    """
    try:
        api_client = get_client("__validate__", config)
        from kubernetes.client import CoreV1Api
        v1 = CoreV1Api(api_client)
        ns_list = v1.list_namespace(limit=5)
        names = [ns.metadata.name for ns in ns_list.items]
        return True, f"Connected — namespaces: {', '.join(names)}"
    except Exception as exc:
        return False, str(exc)
