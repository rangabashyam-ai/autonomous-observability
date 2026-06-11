"""
Normalization models and helpers for cloud topology.

Topology edges represent dependency relationships between discovered cloud
resources.  All providers must produce TopologyEdge objects which are then
merged into the existing dependency graph.
"""

from __future__ import annotations

from typing import List

from pydantic import BaseModel


class TopologyEdge(BaseModel):
    source: str                 # resource id of the upstream node
    target: str                 # resource id of the downstream node
    relationship: str = "DEPENDS_ON"
    provider: str               # "aws" | "azure" | "gcp" | "kubernetes"
    source_type: str = "unknown"
    target_type: str = "unknown"

    def to_dependency_dict(self) -> dict:
        """Return a dict compatible with the existing dependency_graph.json edge schema."""
        return {
            "source": self.source,
            "target": self.target,
            "relationship": self.relationship,
            "type": "cloud_dependency",
            "provider": self.provider,
        }


def build_aws_topology(resources: list[dict]) -> list[TopologyEdge]:
    """
    Infer topology edges from a list of discovered AWS resources.

    Rules:
    - Each EKS cluster → any RDS instance in the same region (DEPENDS_ON)
    - Each ALB → any EKS cluster in the same region (ROUTES_TO)
    """
    edges: list[TopologyEdge] = []
    eks_clusters = [r for r in resources if r.get("resource_type") == "eks_cluster"]
    rds_instances = [r for r in resources if r.get("resource_type") == "rds_instance"]
    load_balancers = [r for r in resources if r.get("resource_type") == "load_balancer"]

    for cluster in eks_clusters:
        for rds in rds_instances:
            if cluster.get("region") == rds.get("region"):
                edges.append(TopologyEdge(
                    source=cluster["id"],
                    target=rds["id"],
                    relationship="DEPENDS_ON",
                    provider="aws",
                    source_type="eks_cluster",
                    target_type="rds_instance",
                ))
        for lb in load_balancers:
            if lb.get("region") == cluster.get("region"):
                edges.append(TopologyEdge(
                    source=lb["id"],
                    target=cluster["id"],
                    relationship="ROUTES_TO",
                    provider="aws",
                    source_type="load_balancer",
                    target_type="eks_cluster",
                ))
    return edges


def build_azure_topology(resources: list[dict]) -> list[TopologyEdge]:
    """
    Infer topology edges from discovered Azure resources.

    Rules:
    - Each AKS cluster → any Azure SQL instance in same resource group (DEPENDS_ON)
    """
    edges: list[TopologyEdge] = []
    aks_clusters = [r for r in resources if r.get("resource_type") == "aks_cluster"]
    sql_instances = [r for r in resources if r.get("resource_type") == "azure_sql"]

    for cluster in aks_clusters:
        for sql in sql_instances:
            if cluster.get("region") == sql.get("region"):
                edges.append(TopologyEdge(
                    source=cluster["id"],
                    target=sql["id"],
                    relationship="DEPENDS_ON",
                    provider="azure",
                    source_type="aks_cluster",
                    target_type="azure_sql",
                ))
    return edges


def build_gcp_topology(resources: list[dict]) -> list[TopologyEdge]:
    """
    Infer topology edges from discovered GCP resources.

    Rules:
    - Each GKE cluster → any Cloud SQL instance in same region (DEPENDS_ON)
    """
    edges: list[TopologyEdge] = []
    gke_clusters = [r for r in resources if r.get("resource_type") == "gke_cluster"]
    sql_instances = [r for r in resources if r.get("resource_type") == "cloud_sql"]

    for cluster in gke_clusters:
        for sql in sql_instances:
            if cluster.get("region") == sql.get("region"):
                edges.append(TopologyEdge(
                    source=cluster["id"],
                    target=sql["id"],
                    relationship="DEPENDS_ON",
                    provider="gcp",
                    source_type="gke_cluster",
                    target_type="cloud_sql",
                ))
    return edges


def build_k8s_topology(resources: list[dict]) -> list[TopologyEdge]:
    """
    Build topology edges from Kubernetes resources.

    Rules:
    - Deployment → Pod (MANAGES)
    - Service → Pod (ROUTES_TO, matched by namespace)
    """
    edges: list[TopologyEdge] = []
    deployments = [r for r in resources if r.get("resource_type") == "k8s_deployment"]
    pods = [r for r in resources if r.get("resource_type") == "k8s_pod"]
    services = [r for r in resources if r.get("resource_type") == "k8s_service"]

    for deployment in deployments:
        ns = deployment.get("namespace", "default")
        dep_name = deployment.get("name", "")
        for pod in pods:
            # Simple match: pod name starts with deployment name (common K8s pattern)
            if pod.get("namespace") == ns and pod.get("name", "").startswith(dep_name):
                edges.append(TopologyEdge(
                    source=deployment["id"],
                    target=pod["id"],
                    relationship="MANAGES",
                    provider="kubernetes",
                    source_type="k8s_deployment",
                    target_type="k8s_pod",
                ))

    for svc in services:
        ns = svc.get("namespace", "default")
        for pod in pods:
            if pod.get("namespace") == ns:
                edges.append(TopologyEdge(
                    source=svc["id"],
                    target=pod["id"],
                    relationship="ROUTES_TO",
                    provider="kubernetes",
                    source_type="k8s_service",
                    target_type="k8s_pod",
                ))
    return edges


def build_topology_from_resources(resources: list[dict]) -> list[TopologyEdge]:
    """Entry point: build all topology edges from a mixed list of resources."""
    edges: list[TopologyEdge] = []
    by_provider: dict[str, list[dict]] = {}
    for r in resources:
        p = r.get("provider", "unknown")
        by_provider.setdefault(p, []).append(r)

    if "aws" in by_provider:
        edges.extend(build_aws_topology(by_provider["aws"]))
    if "azure" in by_provider:
        edges.extend(build_azure_topology(by_provider["azure"]))
    if "gcp" in by_provider:
        edges.extend(build_gcp_topology(by_provider["gcp"]))
    if "kubernetes" in by_provider:
        edges.extend(build_k8s_topology(by_provider["kubernetes"]))
    return edges
