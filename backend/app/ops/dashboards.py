"""Dashboard definitions for Service Operations and Platform Operations."""

from app.ops.models import OpsDashboardDefinition, OpsDashboardSection, OpsSectionWidget


def _service_ops_dashboard() -> OpsDashboardDefinition:
    return OpsDashboardDefinition(
        id="service-ops",
        title="Service Operations",
        description="Business services, applications, and user-facing systems — regardless of where they run.",
        perspective="service",
        sections=[
            OpsDashboardSection(
                id="overview",
                label="Overview",
                description="Fleet health, incidents, and key service metrics",
                icon="layout-dashboard",
                widgets=[
                    OpsSectionWidget(widget_type="metric_cards", title="Key Metrics"),
                    OpsSectionWidget(widget_type="service_health_table", title="Service Health", entity_types=["microservice"]),
                    OpsSectionWidget(widget_type="dependency_graph", title="Service Dependencies"),
                    OpsSectionWidget(widget_type="incidents_sidebar", title="Active Incidents"),
                ],
            ),
            OpsDashboardSection(
                id="business_services",
                label="Business Services",
                entity_types=["business_service"],
                widgets=[OpsSectionWidget(widget_type="entity_table", title="Business Services", derive_key="business_services")],
            ),
            OpsDashboardSection(
                id="applications",
                label="Applications",
                entity_types=["application", "microservice"],
                widgets=[OpsSectionWidget(widget_type="entity_table", title="Applications", derive_key="applications")],
            ),
            OpsDashboardSection(
                id="apis",
                label="APIs",
                entity_types=["api"],
                widgets=[OpsSectionWidget(widget_type="entity_table", title="API Endpoints", derive_key="apis")],
            ),
            OpsDashboardSection(
                id="workers",
                label="Workers",
                entity_types=["worker", "queue"],
                widgets=[OpsSectionWidget(widget_type="entity_table", title="Message Consumers", derive_key="workers")],
            ),
            OpsDashboardSection(
                id="batch_jobs",
                label="Batch Jobs",
                entity_types=["batch_job", "pod"],
                widgets=[OpsSectionWidget(widget_type="entity_table", title="Scheduled Tasks", derive_key="batch_jobs")],
            ),
            OpsDashboardSection(
                id="pipelines",
                label="Data Pipelines",
                entity_types=["pipeline"],
                widgets=[OpsSectionWidget(widget_type="entity_table", title="Data Pipelines", derive_key="pipelines")],
            ),
            OpsDashboardSection(
                id="ai_services",
                label="AI Services",
                entity_types=["ai_service", "microservice"],
                widgets=[OpsSectionWidget(widget_type="entity_table", title="AI / ML Services", derive_key="ai_services")],
            ),
            OpsDashboardSection(
                id="dependencies",
                label="Dependencies",
                widgets=[OpsSectionWidget(widget_type="dependency_graph", title="Service Topology")],
            ),
            OpsDashboardSection(
                id="transactions",
                label="Transactions",
                widgets=[OpsSectionWidget(widget_type="entity_table", title="Business Transactions", derive_key="transactions")],
            ),
            OpsDashboardSection(
                id="traces",
                label="Traces",
                widgets=[OpsSectionWidget(widget_type="entity_table", title="Distributed Traces", derive_key="traces")],
            ),
            OpsDashboardSection(
                id="incidents",
                label="Incidents",
                widgets=[OpsSectionWidget(widget_type="incidents_timeline", title="Incident Timeline")],
            ),
            OpsDashboardSection(
                id="slo_sla",
                label="SLO / SLA",
                widgets=[OpsSectionWidget(widget_type="entity_table", title="SLO Compliance", derive_key="slos")],
            ),
            OpsDashboardSection(
                id="deployments",
                label="Deployments",
                widgets=[OpsSectionWidget(widget_type="entity_table", title="Deployment History", derive_key="deployments")],
            ),
            OpsDashboardSection(
                id="security",
                label="Security",
                widgets=[OpsSectionWidget(widget_type="entity_table", title="Security Findings", derive_key="security")],
            ),
            OpsDashboardSection(
                id="cost",
                label="Cost",
                widgets=[OpsSectionWidget(widget_type="entity_table", title="Cost per Service", derive_key="costs")],
            ),
        ],
    )


def _platform_ops_dashboard() -> OpsDashboardDefinition:
    return OpsDashboardDefinition(
        id="platform-ops",
        title="Platform Operations",
        description="Infrastructure, runtime, cloud, networking, storage, and platform health.",
        perspective="platform",
        sections=[
            OpsDashboardSection(
                id="overview",
                label="Overview",
                description="Platform health, capacity, and infrastructure summary",
                icon="server",
                widgets=[
                    OpsSectionWidget(widget_type="metric_cards", title="Platform Metrics"),
                    OpsSectionWidget(widget_type="heatmap", title="Resource Heatmaps"),
                    OpsSectionWidget(widget_type="infra_tables", title="Infrastructure Details"),
                ],
            ),
            OpsDashboardSection(
                id="inventory",
                label="Inventory",
                entity_types=["host", "vm", "node", "pod", "database", "queue"],
                widgets=[OpsSectionWidget(widget_type="entity_table", title="Full Inventory", derive_key="inventory")],
            ),
            OpsDashboardSection(
                id="compute",
                label="Compute",
                entity_types=["host", "vm", "node"],
                widgets=[OpsSectionWidget(widget_type="entity_table", title="Compute Hosts", derive_key="compute_hosts")],
            ),
            OpsDashboardSection(
                id="containers",
                label="Containers",
                entity_types=["pod", "container"],
                widgets=[OpsSectionWidget(widget_type="entity_table", title="Containers & Pods", derive_key="k8s_pods")],
            ),
            OpsDashboardSection(
                id="cloud",
                label="Cloud",
                entity_types=["cloud_account", "vm"],
                widgets=[OpsSectionWidget(widget_type="entity_table", title="Cloud Accounts", derive_key="cloud_accounts")],
            ),
            OpsDashboardSection(
                id="virtualization",
                label="Virtualization",
                entity_types=["vm", "host"],
                widgets=[OpsSectionWidget(widget_type="entity_table", title="Hypervisors", derive_key="virtualization")],
            ),
            OpsDashboardSection(
                id="networking",
                label="Networking",
                entity_types=["network", "load_balancer", "gateway"],
                widgets=[OpsSectionWidget(widget_type="entity_table", title="Network Resources", derive_key="networking")],
            ),
            OpsDashboardSection(
                id="storage",
                label="Storage",
                entity_types=["storage"],
                widgets=[OpsSectionWidget(widget_type="entity_table", title="Storage Volumes", derive_key="storage")],
            ),
            OpsDashboardSection(
                id="runtime",
                label="Runtime",
                entity_types=["runtime"],
                widgets=[OpsSectionWidget(widget_type="entity_table", title="JVM / Runtime Metrics", derive_key="runtime")],
            ),
            OpsDashboardSection(
                id="databases",
                label="Databases",
                entity_types=["database", "cache"],
                widgets=[OpsSectionWidget(widget_type="entity_table", title="Databases", derive_key="databases")],
            ),
            OpsDashboardSection(
                id="messaging",
                label="Messaging",
                entity_types=["queue", "topic"],
                widgets=[OpsSectionWidget(widget_type="entity_table", title="Messaging Platforms", derive_key="messaging")],
            ),
            OpsDashboardSection(
                id="data_platforms",
                label="Data Platforms",
                entity_types=["pipeline"],
                widgets=[OpsSectionWidget(widget_type="entity_table", title="Data Platforms", derive_key="data_platforms")],
            ),
            OpsDashboardSection(
                id="serverless",
                label="Serverless",
                entity_types=["function"],
                widgets=[OpsSectionWidget(widget_type="entity_table", title="Serverless Functions", derive_key="serverless")],
            ),
            OpsDashboardSection(
                id="security",
                label="Security",
                widgets=[OpsSectionWidget(widget_type="entity_table", title="Platform Security", derive_key="platform_security")],
            ),
            OpsDashboardSection(
                id="capacity",
                label="Capacity",
                widgets=[OpsSectionWidget(widget_type="capacity_charts", title="Capacity Utilization")],
            ),
            OpsDashboardSection(
                id="cost",
                label="Cost",
                widgets=[OpsSectionWidget(widget_type="entity_table", title="Cloud Spend", derive_key="platform_cost")],
            ),
            OpsDashboardSection(
                id="platform_health",
                label="Platform Health",
                widgets=[OpsSectionWidget(widget_type="platform_score", title="Platform Score")],
            ),
        ],
    )


DASHBOARDS = {
    "service-ops": _service_ops_dashboard,
    "platform-ops": _platform_ops_dashboard,
}


def get_dashboard(dashboard_id: str) -> OpsDashboardDefinition:
    factory = DASHBOARDS.get(dashboard_id)
    if not factory:
        raise KeyError(f"Unknown dashboard: {dashboard_id}")
    return factory()
