import csv
import io
from typing import Optional

from fastapi import APIRouter, HTTPException, UploadFile, File

from app.data_store import read_json, write_json
from app.models import DependencyEdgeCreate, DependencyUploadJSON

router = APIRouter(prefix="/api/dependencies", tags=["dependencies"])

LAYER_VIEW_MAP = {
    "data_center": ["rack", "network", "platform"],
    "rack": ["rack", "server"],
    "server": ["server"],
    "business_service": ["business_service"],
    "application": ["application", "business_service"],
    "microservice": ["microservice", "application"],
    "infrastructure": ["platform", "network", "server", "rack"],
}


def _get_all_nodes() -> dict[str, dict]:
    services_data = read_json("dependencies/services.json")
    infra_data = read_json("dependencies/infrastructure.json")
    nodes = {}
    for svc in services_data.get("services", []):
        nodes[svc["id"]] = svc
    for node in infra_data.get("nodes", []):
        nodes[node["id"]] = node
    return nodes


def _get_edges() -> list[dict]:
    data = read_json("dependencies/dependency_graph.json")
    return data.get("edges", [])


def _save_edges(edges: list[dict]) -> None:
    from datetime import datetime
    write_json("dependencies/dependency_graph.json", {
        "edges": edges,
        "generated_at": datetime.utcnow().isoformat() + "Z",
    })


def _health_from_metric(value: float) -> str:
    if value >= 80:
        return "critical"
    if value >= 60:
        return "warning"
    return "healthy"


@router.get("/graph")
def get_dependency_graph(
    view: str = "business_service",
    focus_node: Optional[str] = None,
    heatmap: str = "cpu",
):
    nodes_map = _get_all_nodes()
    edges = _get_edges()
    allowed_layers = LAYER_VIEW_MAP.get(view, ["business_service", "application", "microservice"])

    if focus_node and focus_node in nodes_map:
        connected = {focus_node}
        changed = True
        while changed:
            changed = False
            for edge in edges:
                if edge["source"] in connected and edge["target"] not in connected:
                    connected.add(edge["target"])
                    changed = True
                if edge["target"] in connected and edge["source"] not in connected:
                    connected.add(edge["source"])
                    changed = True
        filtered_nodes = {k: v for k, v in nodes_map.items() if k in connected}
    else:
        filtered_nodes = {
            k: v for k, v in nodes_map.items()
            if v.get("layer") in allowed_layers or v.get("type") in allowed_layers
        }

    node_ids = set(filtered_nodes.keys())
    filtered_edges = [
        e for e in edges
        if e["source"] in node_ids and e["target"] in node_ids
    ]

    graph_nodes = []
    for nid, node in filtered_nodes.items():
        metrics = node.get("metrics", {})
        heat_value = metrics.get(heatmap, metrics.get("cpu", 0))
        graph_nodes.append({
            "id": nid,
            "label": node.get("name", nid),
            "type": node.get("type", "unknown"),
            "layer": node.get("layer", "unknown"),
            "health": node.get("health", _health_from_metric(heat_value)),
            "metrics": metrics,
            "heatmap_value": heat_value,
        })

    return {
        "view": view,
        "heatmap": heatmap,
        "focus_node": focus_node,
        "nodes": graph_nodes,
        "edges": filtered_edges,
        "node_count": len(graph_nodes),
        "edge_count": len(filtered_edges),
    }


@router.get("/nodes/{node_id}/paths")
def get_dependency_paths(node_id: str):
    nodes_map = _get_all_nodes()
    if node_id not in nodes_map:
        raise HTTPException(status_code=404, detail="Node not found")

    edges = _get_edges()
    
    # We will use the agent's logic to fetch metrics and determine correlation
    try:
        from app.agents.incident_analysis import _get_metrics_snapshot, _is_correlated
        
        # Get all reachable nodes to fetch metrics
        reachable = {node_id}
        q = [node_id]
        while q:
            n = q.pop(0)
            for e in edges:
                if e["source"] == n and e["target"] not in reachable:
                    reachable.add(e["target"])
                    q.append(e["target"])
                if e["target"] == n and e["source"] not in reachable:
                    reachable.add(e["source"])
                    q.append(e["source"])
                    
        comp_metrics = _get_metrics_snapshot(list(reachable))
    except ImportError:
        comp_metrics = {}
        def _is_correlated(*args): return True

    upstream = []
    downstream = []

    def walk_up(nid, visited):
        for e in edges:
            if e["target"] == nid and e["source"] not in visited:
                src = e["source"]
                visited.add(src)
                corr = _is_correlated(src, nid, comp_metrics) if comp_metrics else True
                upstream.append({
                    "node": src, 
                    "relationship": e["relationship"],
                    "metrics": comp_metrics.get(src, {}),
                    "is_correlated": corr
                })
                walk_up(src, visited)

    def walk_down(nid, visited):
        for e in edges:
            if e["source"] == nid and e["target"] not in visited:
                tgt = e["target"]
                visited.add(tgt)
                corr = _is_correlated(nid, tgt, comp_metrics) if comp_metrics else True
                downstream.append({
                    "node": tgt, 
                    "relationship": e["relationship"],
                    "metrics": comp_metrics.get(tgt, {}),
                    "is_correlated": corr
                })
                walk_down(tgt, visited)

    walk_up(node_id, {node_id})
    walk_down(node_id, {node_id})

    return {
        "node_id": node_id,
        "node": nodes_map[node_id],
        "metrics": comp_metrics.get(node_id, {}),
        "upstream": upstream,
        "downstream": downstream,
    }


@router.get("/nodes")
def list_nodes(layer: Optional[str] = None):
    nodes_map = _get_all_nodes()
    nodes = list(nodes_map.values())
    if layer:
        nodes = [n for n in nodes if n.get("layer") == layer]
    return {"nodes": nodes, "count": len(nodes)}


@router.get("/edges")
def list_edges():
    edges = _get_edges()
    return {"edges": edges, "count": len(edges)}


@router.post("/edges")
def add_dependency(edge: DependencyEdgeCreate):
    edges = _get_edges()
    for e in edges:
        if e["source"] == edge.source and e["target"] == edge.target:
            raise HTTPException(status_code=409, detail="Dependency already exists")
    new_edge = {
        "source": edge.source,
        "target": edge.target,
        "relationship": edge.relationship,
        "type": "dependency",
    }
    edges.append(new_edge)
    _save_edges(edges)
    return {"message": "Dependency added", "edge": new_edge}


@router.put("/edges")
def update_dependency(edge: DependencyEdgeCreate):
    edges = _get_edges()
    found = False
    for i, e in enumerate(edges):
        if e["source"] == edge.source and e["target"] == edge.target:
            edges[i]["relationship"] = edge.relationship
            found = True
            break
    if not found:
        raise HTTPException(status_code=404, detail="Dependency not found")
    _save_edges(edges)
    return {"message": "Dependency updated", "edge": edge.model_dump()}


@router.delete("/edges")
def delete_dependency(source: str, target: str):
    edges = _get_edges()
    new_edges = [e for e in edges if not (e["source"] == source and e["target"] == target)]
    if len(new_edges) == len(edges):
        raise HTTPException(status_code=404, detail="Dependency not found")
    _save_edges(new_edges)
    return {"message": "Dependency deleted", "source": source, "target": target}


@router.post("/upload/json")
def upload_json_dependency(dep: DependencyUploadJSON):
    edge = DependencyEdgeCreate(**dep.model_dump())
    return add_dependency(edge)


@router.post("/upload/csv")
async def upload_csv_dependencies(file: UploadFile = File(...)):
    content = await file.read()
    text = content.decode("utf-8")
    reader = csv.DictReader(io.StringIO(text))
    added = []
    errors = []
    for row in reader:
        try:
            source = row.get("source", "").strip()
            target = row.get("target", "").strip()
            rel = row.get("type", row.get("relationship", "calls")).strip()
            if not source or not target:
                errors.append({"row": row, "error": "Missing source or target"})
                continue
            edge = DependencyEdgeCreate(source=source, target=target, relationship=rel)
            result = add_dependency(edge)
            added.append(result["edge"])
        except HTTPException:
            pass
        except Exception as exc:
            errors.append({"row": row, "error": str(exc)})
    return {"added": added, "added_count": len(added), "errors": errors}
