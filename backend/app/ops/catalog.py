"""Entity type catalog, integrations, and navigation definitions."""

from app.ops.models import EntityTypeInfo, OpsCatalogResponse

ENTITY_TYPES: list[EntityTypeInfo] = [
    # Service perspective
    EntityTypeInfo(id="business_service", label="Business Service", layer="business", perspective="service"),
    EntityTypeInfo(id="application", label="Application", layer="application", perspective="service"),
    EntityTypeInfo(id="microservice", label="Microservice", layer="application", perspective="service"),
    EntityTypeInfo(id="api", label="API", layer="application", perspective="service"),
    EntityTypeInfo(id="frontend", label="Frontend Application", layer="application", perspective="service"),
    EntityTypeInfo(id="backend", label="Backend Service", layer="application", perspective="service"),
    EntityTypeInfo(id="gateway", label="Gateway", layer="application", perspective="service"),
    EntityTypeInfo(id="worker", label="Background Worker", layer="application", perspective="service"),
    EntityTypeInfo(id="batch_job", label="Batch Job", layer="application", perspective="service"),
    EntityTypeInfo(id="pipeline", label="Data Pipeline", layer="data", perspective="service"),
    EntityTypeInfo(id="ai_service", label="AI Service", layer="application", perspective="service"),
    EntityTypeInfo(id="integration_service", label="Integration Service", layer="application", perspective="service"),
    # Platform perspective
    EntityTypeInfo(id="host", label="Physical Host", layer="infrastructure", perspective="platform"),
    EntityTypeInfo(id="vm", label="Virtual Machine", layer="infrastructure", perspective="platform"),
    EntityTypeInfo(id="node", label="Compute Node", layer="infrastructure", perspective="platform"),
    EntityTypeInfo(id="cluster", label="Cluster", layer="infrastructure", perspective="platform"),
    EntityTypeInfo(id="pod", label="Pod / Container", layer="infrastructure", perspective="platform"),
    EntityTypeInfo(id="container", label="Container", layer="infrastructure", perspective="platform"),
    EntityTypeInfo(id="database", label="Database", layer="data", perspective="platform"),
    EntityTypeInfo(id="cache", label="Cache", layer="data", perspective="platform"),
    EntityTypeInfo(id="queue", label="Message Queue", layer="messaging", perspective="platform"),
    EntityTypeInfo(id="topic", label="Topic", layer="messaging", perspective="platform"),
    EntityTypeInfo(id="storage", label="Storage Volume", layer="storage", perspective="platform"),
    EntityTypeInfo(id="load_balancer", label="Load Balancer", layer="network", perspective="platform"),
    EntityTypeInfo(id="network", label="Network Resource", layer="network", perspective="platform"),
    EntityTypeInfo(id="function", label="Serverless Function", layer="compute", perspective="platform"),
    EntityTypeInfo(id="cloud_account", label="Cloud Account", layer="cloud", perspective="platform"),
    EntityTypeInfo(id="runtime", label="Runtime (JVM/CLR)", layer="runtime", perspective="platform"),
]

INTEGRATIONS = [
    "Kubernetes", "Docker", "Prometheus", "Grafana", "Datadog", "Dynatrace", "New Relic",
    "Splunk", "Elastic", "Jaeger", "Zipkin", "OpenTelemetry", "AWS", "Azure", "GCP",
    "VMware", "Hyper-V", "SNMP", "Windows", "Linux", "Airflow", "Spark", "Jenkins",
    "GitHub", "GitLab", "ArgoCD", "Terraform", "Ansible", "Kafka", "RabbitMQ",
    "Oracle", "PostgreSQL", "MongoDB", "Redis",
]

SERVICE_OPS_NAV = [
    {"id": "overview", "label": "Overview"},
    {"id": "business_services", "label": "Business Services"},
    {"id": "applications", "label": "Applications"},
    {"id": "apis", "label": "APIs"},
    {"id": "workers", "label": "Workers"},
    {"id": "batch_jobs", "label": "Batch Jobs"},
    {"id": "pipelines", "label": "Data Pipelines"},
    {"id": "ai_services", "label": "AI Services"},
    {"id": "dependencies", "label": "Dependencies"},
    {"id": "transactions", "label": "Transactions"},
    {"id": "traces", "label": "Traces"},
    {"id": "incidents", "label": "Incidents"},
    {"id": "slo_sla", "label": "SLO / SLA"},
    {"id": "deployments", "label": "Deployments"},
    {"id": "security", "label": "Security"},
    {"id": "cost", "label": "Cost"},
]

PLATFORM_OPS_NAV = [
    {"id": "overview", "label": "Overview"},
    {"id": "inventory", "label": "Inventory"},
    {"id": "compute", "label": "Compute"},
    {"id": "containers", "label": "Containers"},
    {"id": "cloud", "label": "Cloud"},
    {"id": "virtualization", "label": "Virtualization"},
    {"id": "networking", "label": "Networking"},
    {"id": "storage", "label": "Storage"},
    {"id": "runtime", "label": "Runtime"},
    {"id": "databases", "label": "Databases"},
    {"id": "messaging", "label": "Messaging"},
    {"id": "data_platforms", "label": "Data Platforms"},
    {"id": "serverless", "label": "Serverless"},
    {"id": "security", "label": "Security"},
    {"id": "capacity", "label": "Capacity"},
    {"id": "cost", "label": "Cost"},
    {"id": "platform_health", "label": "Platform Health"},
]


def get_catalog() -> OpsCatalogResponse:
    return OpsCatalogResponse(
        entity_types=ENTITY_TYPES,
        integrations=INTEGRATIONS,
        service_nav=SERVICE_OPS_NAV,
        platform_nav=PLATFORM_OPS_NAV,
    )
