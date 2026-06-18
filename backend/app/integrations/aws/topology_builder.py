"""
AWS Real Topology Builder — builds dependency graph from 3 tiers of evidence:

Tier 1 (REAL data):    X-Ray Service Map  → actual traced request flows
Tier 2 (WIRED data):   AWS structural APIs → ALB→TargetGroup→EC2,
                        ECS Service→ALB, EventBridge Rule→Targets,
                        ECS Service→Cluster
Tier 3 (INFERRED):     VPC grouping → resources in same VPC are
                        likely connected (low confidence)

The function returns a list of TopologyEdge objects already used by
graph_builder.py and scheduler.py.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone, timedelta

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Tier 1 — X-Ray Service Map (REAL call graph)
# ---------------------------------------------------------------------------

def build_xray_topology(session, region: str = "us-east-1") -> list[dict]:
    """
    Pull the X-Ray service map for the last 1 hour.
    Returns raw edges:  {"source": name, "target": name, "relationship": "CALLS"}
    These are service names (strings), not ARNs — we match them to resources later.
    """
    edges: list[dict] = []
    try:
        xray = session.client("xray", region_name=region)
        end = datetime.now(timezone.utc)
        start = end - timedelta(hours=1)
        resp = xray.get_service_graph(StartTime=start, EndTime=end)
        services = resp.get("Services", [])

        # Build a name→id map
        id_to_name: dict[int, str] = {}
        for svc in services:
            svc_id = svc.get("ReferenceId")
            svc_name = svc.get("Name", "")
            if svc_id is not None:
                id_to_name[svc_id] = svc_name

        for svc in services:
            svc_name = svc.get("Name", "")
            for edge in svc.get("Edges", []):
                target_id = edge.get("ReferenceId")
                target_name = id_to_name.get(target_id, "")
                if svc_name and target_name and svc_name != target_name:
                    edges.append({
                        "source": svc_name,
                        "target": target_name,
                        "relationship": "CALLS",
                        "tier": 1,
                        "confidence": "high",
                        "source": svc_name,
                        "target": target_name,
                    })

        logger.info(f"[Topology] X-Ray service map: {len(edges)} edges from {len(services)} services")
    except Exception as exc:
        logger.warning(f"[Topology] X-Ray service map failed (X-Ray may not be enabled): {exc}")
    return edges


# ---------------------------------------------------------------------------
# Tier 2 — AWS Structural APIs (WIRED relationships)
# ---------------------------------------------------------------------------

def build_alb_topology(session, region: str = "us-east-1") -> list[dict]:
    """
    ALB → Target Groups → EC2 instances / ECS services.
    These are explicit AWS wiring — the ALB ACTUALLY routes to these targets.
    """
    edges: list[dict] = []
    try:
        elb = session.client("elbv2", region_name=region)

        # Get all load balancers
        lbs = elb.describe_load_balancers().get("LoadBalancers", [])
        for lb in lbs:
            lb_arn = lb["LoadBalancerArn"]
            lb_name = lb["LoadBalancerName"]

            # Get target groups for this LB
            tgs = elb.describe_target_groups(LoadBalancerArn=lb_arn).get("TargetGroups", [])
            for tg in tgs:
                tg_arn = tg["TargetGroupArn"]
                tg_name = tg.get("TargetGroupName", "")
                target_type = tg.get("TargetType", "")  # "instance" | "ip" | "lambda" | "alb"

                # Get health of registered targets
                try:
                    targets = elb.describe_target_health(TargetGroupArn=tg_arn).get("TargetHealthDescriptions", [])
                    for t in targets:
                        target_id = t.get("Target", {}).get("Id", "")
                        if target_id:
                            edges.append({
                                "source": lb_name,
                                "source_id": lb_arn,
                                "source_type": "load_balancer",
                                "target": target_id,
                                "target_id": target_id,
                                "target_type": f"ec2_instance" if target_type == "instance" else target_type,
                                "relationship": "ROUTES_TO",
                                "tier": 2,
                                "confidence": "high",
                                "via": tg_name,
                            })
                except Exception:
                    pass

        logger.info(f"[Topology] ALB structural: {len(edges)} ALB→target edges")
    except Exception as exc:
        logger.warning(f"[Topology] ALB topology failed: {exc}")
    return edges


def build_ecs_topology(session, region: str = "us-east-1") -> list[dict]:
    """
    ECS Cluster → Services (CONTAINS)
    ECS Service → ALB Target Group (EXPOSED_VIA)
    ECS Service → Task Definition (RUNS)
    """
    edges: list[dict] = []
    try:
        ecs = session.client("ecs", region_name=region)
        cluster_arns = ecs.list_clusters().get("clusterArns", [])

        for cluster_arn in cluster_arns:
            cluster_name = cluster_arn.split("/")[-1]

            # List services in cluster
            svc_paginator = ecs.get_paginator("list_services")
            svc_arns: list[str] = []
            for page in svc_paginator.paginate(cluster=cluster_arn):
                svc_arns.extend(page.get("serviceArns", []))

            if not svc_arns:
                continue

            # Describe up to 10 at a time (API limit)
            for i in range(0, len(svc_arns), 10):
                batch = svc_arns[i:i+10]
                svcs = ecs.describe_services(cluster=cluster_arn, services=batch).get("services", [])
                for svc in svcs:
                    svc_name = svc["serviceName"]
                    svc_arn = svc["serviceArn"]

                    # Cluster → Service
                    edges.append({
                        "source": cluster_name,
                        "source_id": cluster_arn,
                        "source_type": "ecs_cluster",
                        "target": svc_name,
                        "target_id": svc_arn,
                        "target_type": "ecs_service",
                        "relationship": "CONTAINS",
                        "tier": 2,
                        "confidence": "high",
                    })

                    # Service → Load Balancer (if attached)
                    for lb in svc.get("loadBalancers", []):
                        tg_arn = lb.get("targetGroupArn", "")
                        lb_name = lb.get("loadBalancerName", "")
                        if tg_arn:
                            edges.append({
                                "source": svc_name,
                                "source_id": svc_arn,
                                "source_type": "ecs_service",
                                "target": tg_arn,
                                "target_id": tg_arn,
                                "target_type": "load_balancer",
                                "relationship": "EXPOSED_VIA",
                                "tier": 2,
                                "confidence": "high",
                            })

                    # Service → Task Definition
                    task_def = svc.get("taskDefinition", "")
                    if task_def:
                        task_family = task_def.split("/")[-1].split(":")[0]
                        edges.append({
                            "source": svc_name,
                            "source_id": svc_arn,
                            "source_type": "ecs_service",
                            "target": task_family,
                            "target_id": task_def,
                            "target_type": "task_definition",
                            "relationship": "RUNS",
                            "tier": 2,
                            "confidence": "high",
                        })

        logger.info(f"[Topology] ECS structural: {len(edges)} edges")
    except Exception as exc:
        logger.warning(f"[Topology] ECS topology failed: {exc}")
    return edges


def build_eventbridge_topology(session, region: str = "us-east-1") -> list[dict]:
    """
    EventBridge Rule → Targets (Lambda ARN, SQS ARN, Kinesis ARN, etc.)
    These are EXPLICIT wiring — the rule literally points to these services.
    """
    edges: list[dict] = []
    try:
        eb = session.client("events", region_name=region)
        buses = eb.list_event_buses().get("EventBuses", [])

        for bus in buses:
            bus_name = bus["Name"]

            paginator = eb.get_paginator("list_rules")
            for page in paginator.paginate(EventBusName=bus_name):
                for rule in page.get("Rules", []):
                    rule_name = rule["Name"]

                    # Get targets for this rule
                    try:
                        targets = eb.list_targets_by_rule(
                            Rule=rule_name, EventBusName=bus_name
                        ).get("Targets", [])

                        for t in targets:
                            target_arn = t.get("Arn", "")
                            if not target_arn:
                                continue

                            # Parse target type from ARN
                            # arn:aws:lambda:... | arn:aws:sqs:... | arn:aws:kinesis:...
                            target_type = "unknown"
                            if ":lambda:" in target_arn:
                                target_type = "lambda"
                                target_name = target_arn.split(":")[-1]
                            elif ":sqs:" in target_arn:
                                target_type = "sqs_queue"
                                target_name = target_arn.split(":")[-1]
                            elif ":kinesis:" in target_arn:
                                target_type = "kinesis_stream"
                                target_name = target_arn.split("/")[-1]
                            elif ":sns:" in target_arn:
                                target_type = "sns_topic"
                                target_name = target_arn.split(":")[-1]
                            elif ":ecs:" in target_arn:
                                target_type = "ecs_cluster"
                                target_name = target_arn.split("/")[-1]
                            else:
                                target_name = target_arn

                            edges.append({
                                "source": rule_name,
                                "source_id": f"{bus_name}/{rule_name}",
                                "source_type": "event_rule",
                                "target": target_name,
                                "target_id": target_arn,
                                "target_type": target_type,
                                "relationship": "TRIGGERS",
                                "tier": 2,
                                "confidence": "high",
                                "bus": bus_name,
                            })
                    except Exception:
                        pass

        logger.info(f"[Topology] EventBridge structural: {len(edges)} rule→target edges")
    except Exception as exc:
        logger.warning(f"[Topology] EventBridge topology failed: {exc}")
    return edges


def build_kinesis_topology(session, region: str = "us-east-1") -> list[dict]:
    """
    Kinesis Streams → Lambda consumers (via enhanced fan-out / event source mappings).
    Lambda → Kinesis is readable from Lambda's event source mappings.
    """
    edges: list[dict] = []
    try:
        lmb = session.client("lambda", region_name=region)

        # List all Lambda functions
        paginator = lmb.get_paginator("list_functions")
        for page in paginator.paginate():
            for fn in page.get("Functions", []):
                fn_name = fn["FunctionName"]
                fn_arn = fn["FunctionArn"]

                # List event source mappings for this function
                try:
                    esms = lmb.list_event_source_mappings(
                        FunctionName=fn_arn
                    ).get("EventSourceMappings", [])

                    for esm in esms:
                        source_arn = esm.get("EventSourceArn", "")
                        if not source_arn:
                            continue

                        if ":kinesis:" in source_arn:
                            stream_name = source_arn.split("/")[-1]
                            edges.append({
                                "source": stream_name,
                                "source_id": source_arn,
                                "source_type": "kinesis_stream",
                                "target": fn_name,
                                "target_id": fn_arn,
                                "target_type": "lambda",
                                "relationship": "STREAMS_TO",
                                "tier": 2,
                                "confidence": "high",
                            })
                        elif ":sqs:" in source_arn:
                            queue_name = source_arn.split(":")[-1]
                            edges.append({
                                "source": queue_name,
                                "source_id": source_arn,
                                "source_type": "sqs_queue",
                                "target": fn_name,
                                "target_id": fn_arn,
                                "target_type": "lambda",
                                "relationship": "TRIGGERS",
                                "tier": 2,
                                "confidence": "high",
                            })
                        elif ":dynamodb:" in source_arn:
                            table_name = source_arn.split("/")[1]
                            edges.append({
                                "source": table_name,
                                "source_id": source_arn,
                                "source_type": "dynamodb_table",
                                "target": fn_name,
                                "target_id": fn_arn,
                                "target_type": "lambda",
                                "relationship": "STREAMS_TO",
                                "tier": 2,
                                "confidence": "high",
                            })
                except Exception:
                    pass

        logger.info(f"[Topology] Kinesis/Lambda structural: {len(edges)} stream→function edges")
    except Exception as exc:
        logger.warning(f"[Topology] Kinesis/Lambda topology failed: {exc}")
    return edges


# ---------------------------------------------------------------------------
# Tier 3 — VPC-based grouping (INFERRED, low confidence)
# ---------------------------------------------------------------------------

def build_vpc_topology(resources: list[dict]) -> list[dict]:
    """
    Resources in the same VPC can likely communicate.
    Groups resources by VPC ID from their metadata and creates
    low-confidence edges within each VPC group.

    Only creates edges between different resource types (not EC2→EC2)
    to avoid edge explosion.
    """
    edges: list[dict] = []

    # Group by VPC id from extras
    vpc_groups: dict[str, list[dict]] = {}
    for r in resources:
        vpc_id = r.get("vpc_id") or r.get("metadata", {}).get("vpc_id", "")
        if vpc_id:
            vpc_groups.setdefault(vpc_id, []).append(r)

    PRIORITY_ORDER = ["load_balancer", "ecs_service", "eks_cluster", "ec2_instance", "rds_instance"]

    for vpc_id, members in vpc_groups.items():
        if len(members) < 2:
            continue

        # Sort by priority to create meaningful direction
        def priority(r: dict) -> int:
            rt = r.get("resource_type", "")
            return PRIORITY_ORDER.index(rt) if rt in PRIORITY_ORDER else 99

        sorted_members = sorted(members, key=priority)

        # Connect adjacent tiers only (don't create all-pairs)
        for i in range(len(sorted_members) - 1):
            src = sorted_members[i]
            tgt = sorted_members[i + 1]
            if src.get("resource_type") != tgt.get("resource_type"):
                edges.append({
                    "source": src.get("name", src.get("id", "")),
                    "source_id": src.get("id", ""),
                    "source_type": src.get("resource_type", ""),
                    "target": tgt.get("name", tgt.get("id", "")),
                    "target_id": tgt.get("id", ""),
                    "target_type": tgt.get("resource_type", ""),
                    "relationship": "NETWORK_PEER",
                    "tier": 3,
                    "confidence": "low",
                    "vpc_id": vpc_id,
                })

    logger.info(f"[Topology] VPC-inferred: {len(edges)} network-peer edges across {len(vpc_groups)} VPCs")
    return edges


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def discover_aws_topology(
    session,
    resources: list[dict],
    region: str = "us-east-1",
    include_tier3: bool = True,
) -> list[dict]:
    """
    Build a complete AWS dependency graph using all 3 tiers.

    Returns a flat list of edge dicts, each with:
      source, source_id, source_type,
      target, target_id, target_type,
      relationship, tier, confidence

    tier=1 → X-Ray real traces (most reliable)
    tier=2 → AWS structural wiring (reliable)
    tier=3 → VPC inferred (low confidence, use as fallback only)
    """
    all_edges: list[dict] = []

    logger.info(f"[Topology] Building AWS topology for {len(resources)} resources in {region}...")

    # Tier 1: X-Ray
    xray_edges = build_xray_topology(session, region)
    all_edges.extend(xray_edges)

    # Tier 2: Structural
    all_edges.extend(build_alb_topology(session, region))
    all_edges.extend(build_ecs_topology(session, region))
    all_edges.extend(build_eventbridge_topology(session, region))
    all_edges.extend(build_kinesis_topology(session, region))

    # Tier 3: VPC grouping (only if no tier-1/2 data)
    tier12_count = len([e for e in all_edges if e.get("tier", 3) <= 2])
    if include_tier3 and tier12_count == 0:
        logger.info("[Topology] No tier-1/2 edges found — falling back to VPC grouping")
        all_edges.extend(build_vpc_topology(resources))
    elif include_tier3:
        # Add VPC edges only for resources not already covered
        covered_nodes = {e["source"] for e in all_edges} | {e["target"] for e in all_edges}
        uncovered = [r for r in resources if r.get("name") not in covered_nodes]
        if uncovered:
            vpc_edges = build_vpc_topology(uncovered)
            all_edges.extend(vpc_edges)
            logger.info(f"[Topology] Added VPC edges for {len(uncovered)} uncovered resources")

    # Deduplicate by (source, target, relationship)
    seen: set[tuple] = set()
    deduped: list[dict] = []
    for e in all_edges:
        key = (e.get("source", ""), e.get("target", ""), e.get("relationship", ""))
        if key not in seen:
            seen.add(key)
            deduped.append(e)

    logger.info(
        f"[Topology] Final: {len(deduped)} edges total "
        f"(T1:{len(xray_edges)} X-Ray, "
        f"T2:{tier12_count} structural, "
        f"T3:{len(deduped)-len(xray_edges)-tier12_count} VPC)"
    )
    return deduped
