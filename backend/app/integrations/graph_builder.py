"""
Knowledge Graph Builder — update the existing RCA knowledge graph with cloud resources.

This module is called after every resource discovery sync.  It reads the
existing knowledge_graph.json (preserving all synthetic data), appends new
cloud resource nodes and topology edges, then writes back.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from pathlib import Path
import json

logger = logging.getLogger(__name__)

_DATA_DIR = Path(__file__).resolve().parent.parent.parent.parent.parent / "data"
_KG_PATH = _DATA_DIR / "rca" / "knowledge_graph.json"
_DEP_GRAPH_PATH = _DATA_DIR / "dependencies" / "dependency_graph.json"


def _load_json(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        with open(path) as f:
            return json.load(f)
    except Exception as exc:
        logger.error(f"Failed to load {path}: {exc}")
        return {}


def _save_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        json.dump(data, f, indent=2)


def update_knowledge_graph(
    resources: list[dict],
    topology_edges: list,          # list of TopologyEdge
    alerts: list,                  # list of NormalizedAlert
) -> None:
    """
    Merge cloud resources, topology edges, and alert nodes into the
    existing RCA knowledge graph.  Existing synthetic data is never removed.
    """
    kg = _load_json(_KG_PATH)
    if not kg:
        kg = {"nodes": [], "edges": [], "pattern_library": [], "stats": {}}

    existing_node_ids = {n["id"] for n in kg.get("nodes", [])}
    existing_edge_pairs = {(e["source"], e["target"]) for e in kg.get("edges", [])}

    nodes_added = 0
    edges_added = 0

    # --- Add resource nodes ---
    for res in resources:
        node_id = f"cloud-{res.get('provider', 'unknown')}-{res.get('id', res.get('name', 'unknown'))}"[:80]
        if node_id not in existing_node_ids:
            kg.setdefault("nodes", []).append({
                "id": node_id,
                "name": res.get("name", node_id),
                "type": "cloud_resource",
                "layer": res.get("resource_type", "infrastructure"),
                "provider": res.get("provider", "unknown"),
                "region": res.get("region", ""),
                "health": res.get("health", "healthy"),
                "metrics": res.get("metrics", {}),
                "discovered_at": res.get("discovered_at", datetime.now(timezone.utc).isoformat()),
            })
            existing_node_ids.add(node_id)
            nodes_added += 1
        else:
            # Update health/metrics on existing node
            for n in kg["nodes"]:
                if n["id"] == node_id:
                    n["health"] = res.get("health", n["health"])
                    n["metrics"] = res.get("metrics", n["metrics"])
                    break

    # --- Add topology edges ---
    for edge in topology_edges:
        src_id = f"cloud-{edge.provider}-{edge.source}"[:80]
        tgt_id = f"cloud-{edge.provider}-{edge.target}"[:80]
        pair = (src_id, tgt_id)
        if pair not in existing_edge_pairs:
            kg.setdefault("edges", []).append({
                "source": src_id,
                "target": tgt_id,
                "relationship": edge.relationship,
                "type": "cloud_dependency",
                "provider": edge.provider,
            })
            existing_edge_pairs.add(pair)
            edges_added += 1

    # --- Add alert nodes ---
    for alert in alerts:
        alert_node_id = f"alert-{alert.alert_id}"[:80]
        if alert_node_id not in existing_node_ids:
            kg.setdefault("nodes", []).append({
                "id": alert_node_id,
                "name": alert.title or alert.alert_type,
                "type": "alert",
                "layer": "alert",
                "provider": alert.provider,
                "severity": alert.severity,
                "status": alert.status,
                "timestamp": alert.timestamp,
            })
            existing_node_ids.add(alert_node_id)
            nodes_added += 1

            # Link alert → resource node
            resource_node_id = f"cloud-{alert.provider}-{alert.resource}"[:80]
            if resource_node_id in existing_node_ids:
                pair = (alert_node_id, resource_node_id)
                if pair not in existing_edge_pairs:
                    kg.setdefault("edges", []).append({
                        "source": alert_node_id,
                        "target": resource_node_id,
                        "relationship": "FIRED_ON",
                        "type": "alert_relationship",
                    })
                    existing_edge_pairs.add(pair)
                    edges_added += 1

    # --- Update stats ---
    kg["stats"] = {
        "node_count": len(kg.get("nodes", [])),
        "edge_count": len(kg.get("edges", [])),
        "pattern_count": len(kg.get("pattern_library", [])),
        "last_cloud_sync": datetime.now(timezone.utc).isoformat(),
        "cloud_nodes_added": nodes_added,
        "cloud_edges_added": edges_added,
    }

    _save_json(_KG_PATH, kg)
    logger.info(
        f"[GraphBuilder] Knowledge graph updated: +{nodes_added} nodes, +{edges_added} edges. "
        f"Total: {kg['stats']['node_count']} nodes, {kg['stats']['edge_count']} edges."
    )


def update_dependency_graph(topology_edges: list) -> None:
    """
    Merge cloud topology edges into the existing dependency_graph.json so
    that the /api/dependencies/graph endpoint reflects real cloud topology.
    """
    dep = _load_json(_DEP_GRAPH_PATH)
    if not dep:
        dep = {"edges": [], "generated_at": ""}

    existing = {(e["source"], e["target"]) for e in dep.get("edges", [])}
    added = 0

    for edge in topology_edges:
        pair = (edge.source, edge.target)
        if pair not in existing:
            dep.setdefault("edges", []).append(edge.to_dependency_dict())
            existing.add(pair)
            added += 1

    dep["generated_at"] = datetime.now(timezone.utc).isoformat()
    _save_json(_DEP_GRAPH_PATH, dep)
    logger.info(f"[GraphBuilder] Dependency graph updated: +{added} cloud topology edges.")
