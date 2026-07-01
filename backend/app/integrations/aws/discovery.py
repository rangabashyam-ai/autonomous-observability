"""
AWS Resource Discovery — EC2, EKS, RDS, Load Balancers.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)


def _make_resource(
    id: str,
    name: str,
    resource_type: str,
    provider: str = "aws",
    region: str = "us-east-1",
    health: str = "healthy",
    extra: dict | None = None,
) -> dict:
    return {
        "id": id,
        "name": name,
        "resource_type": resource_type,
        "provider": provider,
        "region": region,
        "health": health,
        "layer": "infrastructure",
        "metrics": {},
        "discovered_at": datetime.now(timezone.utc).isoformat(),
        **(extra or {}),
    }


def discover_ec2(session, region: str = "us-east-1") -> list[dict]:
    """Discover EC2 instances."""
    try:
        ec2 = session.client("ec2", region_name=region)
        paginator = ec2.get_paginator("describe_instances")
        resources = []
        for page in paginator.paginate():
            for reservation in page.get("Reservations", []):
                for inst in reservation.get("Instances", []):
                    inst_id = inst["InstanceId"]
                    name_tag = next(
                        (t["Value"] for t in inst.get("Tags", []) if t["Key"] == "Name"),
                        inst_id,
                    )
                    state = inst.get("State", {}).get("Name", "unknown")
                    health = "healthy" if state == "running" else "critical" if state in ("stopped", "terminated") else "warning"
                    resources.append(_make_resource(
                        id=inst_id,
                        name=name_tag,
                        resource_type="ec2_instance",
                        region=region,
                        health=health,
                        extra={
                            "instance_type": inst.get("InstanceType", ""),
                            "state": state,
                            "private_ip": inst.get("PrivateIpAddress", ""),
                            "public_ip": inst.get("PublicIpAddress", ""),
                            "availability_zone": inst.get("Placement", {}).get("AvailabilityZone", ""),
                        },
                    ))
        logger.info(f"[AWS] Discovered {len(resources)} EC2 instances in {region}")
        return resources
    except Exception as exc:
        logger.error(f"[AWS] EC2 discovery failed: {exc}")
        return []


def discover_eks(session, region: str = "us-east-1") -> list[dict]:
    """Discover EKS clusters."""
    try:
        eks = session.client("eks", region_name=region)
        cluster_names = eks.list_clusters().get("clusters", [])
        resources = []
        for name in cluster_names:
            try:
                detail = eks.describe_cluster(name=name)["cluster"]
                status = detail.get("status", "UNKNOWN")
                health = "healthy" if status == "ACTIVE" else "critical" if status in ("FAILED", "DELETING") else "warning"
                resources.append(_make_resource(
                    id=detail.get("arn", name),
                    name=name,
                    resource_type="eks_cluster",
                    region=region,
                    health=health,
                    extra={
                        "k8s_version": detail.get("version", ""),
                        "status": status,
                        "endpoint": detail.get("endpoint", ""),
                    },
                ))
            except Exception as exc:
                logger.warning(f"[AWS] Failed to describe EKS cluster '{name}': {exc}")
        logger.info(f"[AWS] Discovered {len(resources)} EKS clusters in {region}")
        return resources
    except Exception as exc:
        logger.error(f"[AWS] EKS discovery failed: {exc}")
        return []


def discover_rds(session, region: str = "us-east-1") -> list[dict]:
    """Discover RDS instances."""
    try:
        rds = session.client("rds", region_name=region)
        paginator = rds.get_paginator("describe_db_instances")
        resources = []
        for page in paginator.paginate():
            for db in page.get("DBInstances", []):
                status = db.get("DBInstanceStatus", "unknown")
                health = "healthy" if status == "available" else "critical" if status in ("failed", "deleting") else "warning"
                resources.append(_make_resource(
                    id=db.get("DBInstanceArn", db["DBInstanceIdentifier"]),
                    name=db["DBInstanceIdentifier"],
                    resource_type="rds_instance",
                    region=region,
                    health=health,
                    extra={
                        "engine": db.get("Engine", ""),
                        "engine_version": db.get("EngineVersion", ""),
                        "instance_class": db.get("DBInstanceClass", ""),
                        "status": status,
                        "multi_az": db.get("MultiAZ", False),
                        "endpoint": db.get("Endpoint", {}).get("Address", ""),
                    },
                ))
        logger.info(f"[AWS] Discovered {len(resources)} RDS instances in {region}")
        return resources
    except Exception as exc:
        logger.error(f"[AWS] RDS discovery failed: {exc}")
        return []


def discover_load_balancers(session, region: str = "us-east-1") -> list[dict]:
    """Discover Application and Network Load Balancers."""
    try:
        elbv2 = session.client("elbv2", region_name=region)
        paginator = elbv2.get_paginator("describe_load_balancers")
        resources = []
        for page in paginator.paginate():
            for lb in page.get("LoadBalancers", []):
                state = lb.get("State", {}).get("Code", "unknown")
                health = "healthy" if state == "active" else "critical" if state in ("failed",) else "warning"
                resources.append(_make_resource(
                    id=lb.get("LoadBalancerArn", lb["LoadBalancerName"]),
                    name=lb["LoadBalancerName"],
                    resource_type="load_balancer",
                    region=region,
                    health=health,
                    extra={
                        "lb_type": lb.get("Type", "application"),
                        "dns_name": lb.get("DNSName", ""),
                        "scheme": lb.get("Scheme", ""),
                        "state": state,
                    },
                ))
        logger.info(f"[AWS] Discovered {len(resources)} Load Balancers in {region}")
        return resources
    except Exception as exc:
        logger.error(f"[AWS] ELB discovery failed: {exc}")
        return []


def discover_ecs(session, region: str = "us-east-1") -> list[dict]:
    """Discover ECS clusters and their services."""
    try:
        ecs = session.client("ecs", region_name=region)
        cluster_arns = ecs.list_clusters().get("clusterArns", [])
        resources: list[dict] = []

        # Describe clusters
        if cluster_arns:
            clusters_detail = ecs.describe_clusters(clusters=cluster_arns).get("clusters", [])
            for cluster in clusters_detail:
                status = cluster.get("status", "UNKNOWN")
                health = "healthy" if status == "ACTIVE" else "critical"
                resources.append(_make_resource(
                    id=cluster.get("clusterArn", cluster["clusterName"]),
                    name=cluster["clusterName"],
                    resource_type="ecs_cluster",
                    region=region,
                    health=health,
                    extra={
                        "status": status,
                        "running_tasks": cluster.get("runningTasksCount", 0),
                        "pending_tasks": cluster.get("pendingTasksCount", 0),
                        "active_services": cluster.get("activeServicesCount", 0),
                    },
                ))

                # List services within the cluster
                try:
                    svc_paginator = ecs.get_paginator("list_services")
                    for page in svc_paginator.paginate(cluster=cluster.get("clusterArn", cluster["clusterName"])):
                        svc_arns = page.get("serviceArns", [])
                        if svc_arns:
                            svcs = ecs.describe_services(
                                cluster=cluster.get("clusterArn", cluster["clusterName"]),
                                services=svc_arns[:10],  # API limit: 10 per call
                            ).get("services", [])
                            for svc in svcs:
                                svc_status = svc.get("status", "UNKNOWN")
                                svc_health = "healthy" if svc_status == "ACTIVE" else "critical"
                                resources.append(_make_resource(
                                    id=svc.get("serviceArn", svc["serviceName"]),
                                    name=svc["serviceName"],
                                    resource_type="ecs_service",
                                    region=region,
                                    health=svc_health,
                                    extra={
                                        "cluster": cluster["clusterName"],
                                        "task_definition": svc.get("taskDefinition", ""),
                                        "desired_count": svc.get("desiredCount", 0),
                                        "running_count": svc.get("runningCount", 0),
                                        "pending_count": svc.get("pendingCount", 0),
                                        "launch_type": svc.get("launchType", ""),
                                    },
                                ))
                except Exception as exc:
                    logger.warning(f"[AWS] Failed to list ECS services in {cluster['clusterName']}: {exc}")

        logger.info(f"[AWS] Discovered {len(resources)} ECS resources in {region}")
        return resources
    except Exception as exc:
        logger.error(f"[AWS] ECS discovery failed: {exc}")
        return []


def discover_kinesis(session, region: str = "us-east-1") -> list[dict]:
    """Discover Kinesis Data Streams."""
    try:
        from app.integrations.aws.kinesis import discover_streams
        return discover_streams(session, region)
    except Exception as exc:
        logger.error(f"[AWS] Kinesis discovery failed: {exc}")
        return []


def discover_event_bridges(session, region: str = "us-east-1") -> list[dict]:
    """Discover EventBridge event buses and rules."""
    try:
        from app.integrations.aws.eventbridge import discover_all as eb_discover_all
        return eb_discover_all(session, region)
    except Exception as exc:
        logger.error(f"[AWS] EventBridge discovery failed: {exc}")
        return []


def discover_all(session, region: str = "us-east-1") -> list[dict]:
    """Run all AWS discovery and return combined resource list."""
    resources: list[dict] = []
    resources.extend(discover_ec2(session, region))
    resources.extend(discover_eks(session, region))
    resources.extend(discover_rds(session, region))
    resources.extend(discover_load_balancers(session, region))
    resources.extend(discover_ecs(session, region))
    resources.extend(discover_kinesis(session, region))
    resources.extend(discover_event_bridges(session, region))
    return resources
