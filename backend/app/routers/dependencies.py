
import csv
import io
import json
import sqlite3
from functools import lru_cache
from typing import Optional
from pathlib import Path

from fastapi import APIRouter, HTTPException, UploadFile, File

from app.data_store import read_json, write_json, DATA_DIR
from app.models import DependencyEdgeCreate, DependencyUploadJSON, NodeCreate

router = APIRouter(prefix="/api/dependencies", tags=["dependencies"])

LAYER_VIEW_MAP = {
    "data_center": ["rack", "network", "platform"],
    "rack": ["rack", "server"],
    "server": ["server"],
    "business_service": ["business_service"],
    "application": ["application", "business_service"],
    "microservice": ["microservice", "application"],
    "infrastructure": ["platform", "network", "server", "rack"],
    "aws": [],
    "gcp": [],
    "azure": [],
    "on-prem-vmware": [],
    "on-prem-physical": [],
}

DB_PATH = DATA_DIR / "dependencies" / "graph_store.db"


def _get_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    
    # Create tables representing our local persisted graph DB
    conn.execute("""
    CREATE TABLE IF NOT EXISTS nodes (
        id TEXT PRIMARY KEY,
        name TEXT,
        type TEXT,
        layer TEXT,
        health TEXT,
        metrics TEXT,
        platform TEXT,
        region TEXT
    )
    """)
    conn.execute("""
    CREATE TABLE IF NOT EXISTS edges (
        source TEXT,
        target TEXT,
        relationship TEXT,
        type TEXT,
        PRIMARY KEY (source, target)
    )
    """)
    conn.commit()
    return conn


@lru_cache(maxsize=1)
def _get_all_nodes() -> dict[str, dict]:
    """Load node data from pre-built JSON files (cached in-process after first call)."""
    services_data = read_json("dependencies/services.json")
    infra_data    = read_json("dependencies/infrastructure.json")

    if not services_data or not infra_data:
        from app import parquet_store
        if not services_data:
            services_data = parquet_store.query("dependencies/services.json")
        if not infra_data:
            infra_data    = parquet_store.query("dependencies/infrastructure.json")

    nodes = {}
    for svc in services_data.get("services", []):
        nodes[svc["id"]] = svc
    for node in infra_data.get("nodes", []):
        nodes[node["id"]] = node
    return nodes


@lru_cache(maxsize=1)
def _get_edges() -> list[dict]:
    """Load edges from pre-built JSON file (cached in-process after first call)."""
    data = read_json("dependencies/dependency_graph.json")
    if not data:
        from app import parquet_store
        data = parquet_store.query("dependencies/dependency_graph.json")
    return data.get("edges", [])


def _init_and_sync_db():
    """Builds the SQLite index and persists the parquet graph dataset to local SQL storage."""
    with _get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT count(*) FROM nodes")
        if cursor.fetchone()[0] > 0:
            return  # Already populated and indexed
        
        # Load from base dataset (acting as initial ingest/migration)
        nodes_map = _get_all_nodes()
        edges = _get_edges()
        
        for nid, node in nodes_map.items():
            metrics_json = json.dumps(node.get("metrics", {}))
            conn.execute(
                "INSERT OR REPLACE INTO nodes (id, name, type, layer, health, metrics, platform, region) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (nid, node.get("name", nid), node.get("type"), node.get("layer"), node.get("health"), metrics_json, node.get("platform"), node.get("region"))
            )
        
        for e in edges:
            conn.execute(
                "INSERT OR REPLACE INTO edges (source, target, relationship, type) VALUES (?, ?, ?, ?)",
                (e["source"], e["target"], e.get("relationship", "depends_on"), e.get("type", "dependency"))
            )
        conn.commit()


def _save_edges(edges: list[dict]) -> None:
    from datetime import datetime
    write_json("dependencies/dependency_graph.json", {
        "edges": edges,
        "generated_at": datetime.utcnow().isoformat() + "Z",
    })
    _get_edges.cache_clear()  # invalidate in-process cache after manual edit


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
    # Ensure the Graph database persistence layer is initialized
    _init_and_sync_db()

    allowed_layers = set()
    views = view.split(",")
    for v in views:
        layers = LAYER_VIEW_MAP.get(v, ["business_service", "application", "microservice"])
        allowed_layers.update(layers)
    requested_platforms = set(views)

    with _get_db() as conn:
        # Step 2: Lazy/On-demand graph expansion starting from the focus node
        if focus_node:
            # We use an optimized SQLite CTE (recursive graph traversal query)
            # to only expand the connected nodes/edges actually needed right now
            cursor = conn.cursor()
            cursor.execute("""
                WITH RECURSIVE graph_paths(node_id, depth) AS (
                    SELECT ?, 0
                    UNION
                    SELECT CASE WHEN e.source = gp.node_id THEN e.target ELSE e.source END, gp.depth + 1
                    FROM edges e
                    JOIN graph_paths gp ON e.source = gp.node_id OR e.target = gp.node_id
                    WHERE gp.depth < 10
                )
                SELECT DISTINCT node_id FROM graph_paths;
            """, (focus_node,))
            connected_ids = [row[0] for row in cursor.fetchall()]
            
            # Retrieve only these expanded nodes
            placeholders = ",".join("?" for _ in connected_ids)
            if not placeholders:
                filtered_nodes_list = []
            else:
                cursor.execute(f"SELECT * FROM nodes WHERE id IN ({placeholders})", connected_ids)
                filtered_nodes_list = [dict(row) for row in cursor.fetchall()]
        else:
            # Otherwise, read from the indexed sharded layout filtered by selected layers/platforms
            cursor = conn.cursor()
            query_str = """
                SELECT * FROM nodes 
                WHERE layer IN ({}) OR type IN ({}) OR platform IN ({})
            """.format(
                ",".join(f"'{l}'" for l in allowed_layers),
                ",".join(f"'{l}'" for l in allowed_layers),
                ",".join(f"'{p}'" for p in requested_platforms)
            )
            cursor.execute(query_str)
            filtered_nodes_list = [dict(row) for row in cursor.fetchall()]

        # Collect node IDs
        node_ids = {n["id"] for n in filtered_nodes_list}

        # Query only edges matching our retrieved nodes (Index lookup)
        placeholders = ",".join("?" for _ in node_ids)
        if not placeholders:
            filtered_edges = []
        else:
            cursor = conn.cursor()
            # Double lookup index
            args = list(node_ids) + list(node_ids)
            cursor.execute(
                f"SELECT * FROM edges WHERE source IN ({placeholders}) AND target IN ({placeholders})",
                args
            )
            filtered_edges = [
                {
                    "source": row["source"],
                    "target": row["target"],
                    "relationship": row["relationship"],
                    "type": row["type"]
                }
                for row in cursor.fetchall()
            ]

    # Convert retrieved SQL rows to output format
    graph_nodes = []
    for node in filtered_nodes_list:
        nid = node["id"]
        metrics = json.loads(node["metrics"] or "{}")
        heat_value = metrics.get(heatmap, metrics.get("cpu", 0))
        
        graph_nodes.append({
            "id": nid,
            "label": node["name"] or nid,
            "type": node["type"] or "unknown",
            "layer": node["layer"] or "unknown",
            "health": node["health"] or _health_from_metric(heat_value),
            "metrics": metrics,
            "heatmap_value": heat_value,
            "platform": node["platform"],
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


@router.post("/nodes")
def add_node(node: NodeCreate):
    """Upsert a node into the dependency graph JSON files."""
    nodes_map = dict(_get_all_nodes())
    new_node: dict = {
        "id": node.id,
        "name": node.name,
        "type": node.type,
        "layer": node.layer,
        "health": node.health,
        "metrics": node.metrics or {},
    }
    if node.platform:
        new_node["platform"] = node.platform
    nodes_map[node.id] = new_node
    _save_nodes_to_files(nodes_map)
    return {"message": "Node saved", "node": new_node}


@router.get("/edges")
def list_edges():
    edges = _get_edges()
    return {"edges": edges, "count": len(edges)}


@router.post("/edges")
def add_dependency(edge: DependencyEdgeCreate):
    _init_and_sync_db()
    
    # Save directly to the persisted SQLite Graph database
    with _get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT count(*) FROM edges WHERE source = ? AND target = ?",
            (edge.source, edge.target)
        )
        if cursor.fetchone()[0] > 0:
            raise HTTPException(status_code=409, detail="Dependency already exists")
            
        # Ensure source/target nodes exist in our node table so they render properly
        for node_id in (edge.source, edge.target):
            cursor.execute("SELECT count(*) FROM nodes WHERE id = ?", (node_id,))
            if cursor.fetchone()[0] == 0:
                # Add mock node details
                conn.execute(
                    "INSERT INTO nodes (id, name, type, layer, health, metrics, platform, region) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    (node_id, node_id, "unknown", "microservice", "healthy", "{}", "aws", "us-east-1")
                )
                
        new_edge = {
            "source": edge.source,
            "target": edge.target,
            "relationship": edge.relationship,
            "type": "dependency"
        }
        
        conn.execute(
            "INSERT INTO edges (source, target, relationship, type) VALUES (?, ?, ?, ?)",
            (edge.source, edge.target, edge.relationship, "dependency")
        )
        conn.commit()

    # Fallback dual-write to JSON file for backward compatibility
    edges = _get_edges()
    edges.append(new_edge)
    _save_edges(edges)
    return {"message": "Dependency added", "edge": new_edge}


@router.put("/edges")
def update_dependency(edge: DependencyEdgeCreate):
    _init_and_sync_db()
    with _get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE edges SET relationship = ? WHERE source = ? AND target = ?",
            (edge.relationship, edge.source, edge.target)
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Dependency not found")
        conn.commit()

    # Sync to JSON
    edges = _get_edges()
    found = False
    for i, e in enumerate(edges):
        if e["source"] == edge.source and e["target"] == edge.target:
            edges[i]["relationship"] = edge.relationship
            found = True
            break
    _save_edges(edges)
    return {"message": "Dependency updated", "edge": edge.model_dump()}


@router.delete("/edges")
def delete_dependency(source: str, target: str):
    _init_and_sync_db()
    with _get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "DELETE FROM edges WHERE source = ? AND target = ?",
            (source, target)
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Dependency not found")
        conn.commit()

    # Sync to JSON
    edges = _get_edges()
    new_edges = [e for e in edges if not (e["source"] == source and e["target"] == target)]
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
