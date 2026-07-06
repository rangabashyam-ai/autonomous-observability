# API Catalog — Autonomous Observability Platform

Complete reference for every routed service: API calls, request/response formats, and VM ingest endpoints required to display values in the UI.

**Base URL:** `/api` (Vite dev proxy → backend port 8000)

The frontend only displays data. It does not compute metrics, derive table rows, or parse OTLP.

---

## Global Conventions

### Data Availability Flags

| Flag | Meaning |
|------|---------|
| `dataset_available: true` | Page may show live values |
| `analysis_ready: true` | Early Detection engine can run (needs pattern library + dependency graph, or VM push) |
| `source` | Data origin: `vm_push`, `minio_parquet`, `minio_intel`, `parquet`, `entities`, `none` |

### Data Flow

```
VM / Producer  →  POST /api/vm/ingest/*
Frontend       →  GET  /api/*  (vm_data_store | MinIO | parquet fallback)
Traces         →  GET  /api/vm/traces/spans  (backend parses OTLP from VM :8080)
```

---

## VM Ingest APIs (Data Producer)

How the external observability VM (or any producer) feeds the UI.

| Method | Endpoint | Body Format |
|--------|----------|-------------|
| `GET` | `/api/vm/ingest/status` | — returns stored keys |
| `POST` | `/api/vm/ingest/monitoring/dashboard` | Full `MonitoringDashboard` (see §2) |
| `POST` | `/api/vm/ingest/dependencies/graph` | `{ "nodes": GraphNode[], "edges": GraphEdge[] }` |
| `POST` | `/api/vm/ingest/overview` | Full `Overview` (see §1) |
| `POST` | `/api/vm/ingest/early-detection` | Full early-detection response (see §11) |
| `POST` | `/api/vm/ingest/ops/entities` | `{ "entities": OpsEntity[] }` |
| `POST` | `/api/vm/ingest/ops/sections` | `{ "dashboard_id", "derive_key", "rows": [] }` |
| `POST` | `/api/vm/ingest/timeseries` | `{ "metric", "entity_id?", "points": [{ "t": number, "v": number }] }` |
| `POST` | `/api/vm/ingest/incidents` | `{ "incidents": BankIncident[] }` |
| `POST` | `/api/vm/ingest/alerts` | `{ "alerts": [] }` |
| `POST` | `/api/vm/ingest/widgets/{dashboard_id}` | Pre-computed widget payloads |
| `DELETE` | `/api/vm/ingest/clear` | Clears VM store |

---

## 1. Shell / Layout (All Pages)

**Route:** shared across all pages (sidebar, notifications)

| API | Method | Params/Body | Response Fields Used |
|-----|--------|-------------|----------------------|
| `/api/overview` | `POST` | no body | `summary`, `recent_incidents`, `early_detections`, `open_alerts_preview` |

```json
{
  "summary": {
    "total_incidents": 0,
    "active_incidents": 0,
    "open_alerts": 0,
    "knowledge_graph_nodes": 0,
    "knowledge_graph_edges": 0,
    "early_warnings": 0,
    "active_investigations": 0
  },
  "recent_incidents": [
    { "incident_id": "", "title": "", "severity": "", "service": "", "root_cause": "" }
  ],
  "top_root_causes": [{ "root_cause": "", "count": 0 }],
  "early_detections": [],
  "open_alerts_preview": [{ "title": "", "severity": "", "entity_id": "" }]
}
```

**VM ingest:** `POST /api/vm/ingest/overview`

---

## 2. Executive Command Center (`/`)

| API | Method | Query/Body | Fields Displayed |
|-----|--------|------------|------------------|
| `/api/monitoring/dashboard` | `GET` | — | `dataset_available`, `executive`, `service.services` |
| `/api/overview` | `POST` | — | Summary cards, recent incidents |
| `/api/dependencies/graph` | `GET` | `view=microservice,aws,gcp,azure&heatmap=risk_score` | `nodes`, `edges`, `dataset_available` |
| `/api/monitoring/timeseries` | `GET` | `metric=business_kpi` | `points: [{ t, v }]` |

### MonitoringDashboard Shape

```json
{
  "dataset_available": true,
  "executive": {
    "service_availability": 99.9,
    "transaction_success_rate": 99.5,
    "sla_compliance": 98.0,
    "revenue_impact_usd": 0,
    "customer_impact_count": 0,
    "services_at_risk": 2,
    "active_incidents": 5
  },
  "service": {
    "services": [{
      "id": "payment-authorization",
      "name": "Payment Authorization",
      "health": "healthy",
      "latency_p99_ms": 120,
      "error_rate": 0.1,
      "throughput_rps": 450,
      "transaction_volume": 12000,
      "availability": 99.9
    }]
  },
  "technical": {
    "containers": [{ "id": "", "status": "", "cpu": 0, "memory": 0 }],
    "apis": [{ "name": "", "latency_ms": 0, "error_rate": 0, "requests_per_sec": 0 }],
    "databases": [{ "id": "", "connections": 0, "query_latency_ms": 0, "replication_lag_ms": 0 }],
    "queues": [{ "id": "", "depth": 0, "consumer_lag": 0, "throughput_msg_s": 0 }],
    "jvm": [{ "service": "", "heap_used_pct": 0, "thread_count": 0, "gc_pause_ms": 0 }]
  },
  "infrastructure": {
    "summary": { "avg_cpu": 0, "avg_memory": 0, "avg_storage": 0, "avg_network": 0, "avg_io": 0 },
    "servers": [{ "id": "", "cpu": 0, "memory": 0, "storage": 0, "network": 0, "io": 0 }]
  }
}
```

### GraphNode (Regional Health Map)

```json
{
  "id": "payment-authorization",
  "label": "Payment Authorization",
  "type": "microservice",
  "layer": "application",
  "health": "healthy",
  "metrics": {
    "cpu": 0, "memory": 0, "latency": 0, "error_rate": 0,
    "risk_score": 0, "incident_count": 0
  },
  "heatmap_value": 0.0,
  "platform": "aws",
  "region": "us-east"
}
```

**VM ingest:** `POST /api/vm/ingest/monitoring/dashboard`, `POST /api/vm/ingest/dependencies/graph`, `POST /api/vm/ingest/timeseries`

---

## 3. Service Operations Center (`/operations`)

| API | Method | Query | Purpose |
|-----|--------|-------|---------|
| `/api/monitoring/dashboard` | `GET` | — | Overview tab KPIs, service table |
| `/api/overview` | `POST` | — | Incidents preview, early detections |
| `/api/dependencies/graph` | `GET` | `view=microservice&heatmap=latency` | Mini topology (12 nodes) |
| `/api/monitoring/timeseries` | `GET` | `metric=latency_p99` | Latency trend chart |
| `/api/monitoring/timeseries` | `GET` | `metric=error_rate` | Error trend chart |
| `/api/dependencies/nodes/{nodeId}/paths` | `GET` | — | Service drawer upstream/downstream |
| `/api/ops/catalog` | `GET` | — | Nav items |
| `/api/ops/dashboards/service-ops` | `GET` | — | Section definitions |
| `/api/ops/entities` | `GET` | `perspective=service` | Entity registry for drawer linking |
| `/api/ops/sections/service-ops/{derive_key}` | `GET` | `perspective=service` | Pre-shaped table rows per section |
| `/api/ops/entities/{entityId}/telemetry` | `GET` | — | Entity drawer tabs (metrics/logs/traces) |

**Gate:** `monitoring.dataset_available === false` → empty state + upload banner.

### Service Ops `derive_key` → Required Row Fields

| derive_key | Required Row Fields |
|------------|---------------------|
| `business_services` | `name`, `availability`, `latency_ms`, `error_rate_pct`, `owner`, `health` or `status` |
| `applications` | `name`, `type`, `language`, `instances`, `latency_p95`, `health` or `status` |
| `apis` | `path`, `method`, `rps`, `p95_latency`, `status` |
| `workers` | `name`, `msgRate`, `consumerLag`, `status` |
| `batch_jobs` | `name`, `schedule`, `lastRun`, `status` |
| `pipelines` | `name`, `type`, `throughput`, `status` |
| `ai_services` | `name`, `model`, `latencyMs`, `status` |
| `transactions` | `name`, `volume`, `completionRate`, `status` |
| `traces` | `rootPath`, `service`, `durationMs`, `status` |
| `slos` | `name`, `target`, `current`, `burnRate`, `status` |
| `deployments` | `service`, `version`, `timestamp`, `status` |
| `security` | `cve`, `service`, `severity`, `status` |
| `costs` | `service`, `monthlyCostUSD`, `idleWastedUSD` |

**VM ingest per section:**

```json
POST /api/vm/ingest/ops/sections
{
  "dashboard_id": "service-ops",
  "derive_key": "business_services",
  "rows": [{
    "name": "Payments",
    "availability": 99.9,
    "latency_ms": 85,
    "error_rate_pct": 0.2,
    "owner": "SRE",
    "health": "healthy"
  }]
}
```

### OpsEntity (Entity Drawer + Registry)

```json
{
  "id": "payment-authorization",
  "name": "Payment Authorization",
  "entity_type": "microservice",
  "layer": "application",
  "health": "healthy",
  "platform": "aws",
  "region": "us-east",
  "parent_id": "payments-app",
  "owner": "Payments SRE",
  "metrics": { "latency_p99": 120 },
  "metadata": {},
  "relationships": ["postgres-cluster"]
}
```

### OpsEntityTelemetry (Drawer Tabs)

```json
{
  "entity_id": "",
  "entity_name": "",
  "window": { "start": "ISO", "end": "ISO" },
  "dataset_available": true,
  "metrics": [{
    "timestamp": "", "request_rate": 0, "success_rate": 0,
    "request_count": 0, "mean_response_time": 0
  }],
  "host_metrics": [{ "timestamp": "", "host": "", "cpu": 0 }],
  "logs": [{
    "timestamp": "", "host": "", "log_name": "",
    "message": "", "severity": "info"
  }],
  "traces": [{
    "trace_id": "", "service": "", "host": "",
    "timestamp": "", "has_parent": false
  }]
}
```

**Entity incidents panel:** `GET /api/incidents/?service={name}&limit=25` and `GET /api/incidents/?search={name}&limit=25`

---

## 4. Platform Operations (`/platform`)

| API | Method | Query | Purpose |
|-----|--------|-------|---------|
| `/api/monitoring/dashboard` | `GET` | — | K8s, APIs, DBs, queues, JVM, infra summary tables |
| `/api/ops/catalog` | `GET` | — | Platform nav |
| `/api/ops/dashboards/platform-ops` | `GET` | — | Section definitions |
| `/api/ops/entities` | `GET` | `perspective=platform` | Entity registry |
| `/api/ops/sections/platform-ops/{derive_key}` | `GET` | `perspective=platform` | Section table rows |
| `/api/ops/entities/{entityId}/telemetry` | `GET` | — | Entity drawer |

### Platform Ops `derive_key` → Required Row Fields

| derive_key | Required Row Fields |
|------------|---------------------|
| `inventory` | `name`, `type`, `platform`, `region`, `health` or `status` |
| `compute_hosts` | `name`, `provider`, `cpuUsagePct`, `memoryUsagePct`, `health` |
| `k8s_pods` | `name`, `namespace`, `node`, `status`, `health` |
| `cloud_accounts` | `accountName`, `provider`, `regionsActive`, `monthlySpendUSD` |
| `virtualization` | `name`, `hypervisor`, `vmsCount`, `status` |
| `networking` | `name`, `type`, `latencyMs`, `status` |
| `storage` | `name`, `type`, `capacityUsedPct`, `health` |
| `runtime` | `name`, `heapPct`, `threads`, `gcPauseMs`, `health` |
| `databases` | `name`, `engine`, `connectionsActive`, `avgQueryTimeMs`, `health` |
| `messaging` | `name`, `type`, `consumerLag`, `health` |
| `data_platforms` | `name`, `platform`, `throughput`, `status` |
| `serverless` | `name`, `provider`, `invocations`, `health` |
| `platform_security` | `cve`, `category`, `severity`, `status` |
| `platform_cost` | `account`, `provider`, `monthlySpendUSD`, `forecastUSD` |
| `capacity_charts` / `platform_score` | `resourceName`, `currentUsagePct`, `daysToExhaustion`, `recommendation` |

**VM ingest:** `dashboard_id: "platform-ops"` with same `POST /api/vm/ingest/ops/sections` format.

---

## 5. AI Operations Copilot (`/copilot`)

| API | Method | Body | Response |
|-----|--------|------|----------|
| `/api/overview` | `POST` | — | Case list from `recent_incidents`, `early_detections` |
| `/api/copilot/ask` | `POST` | `{ "question": "..." }` | `{ question, answer, sources[], suggested_actions[] }` |

---

## 6. Dependency Map (`/dependencies`)

| API | Method | Query/Body | Purpose |
|-----|--------|------------|---------|
| `/api/monitoring/dashboard` | `GET` | — | Gating |
| `/api/dependencies/graph` | `GET` | `view={views}&heatmap={metric}&focus_node?` | Graph render |
| `/api/dependencies/nodes/{id}/paths` | `GET` | — | Upstream/downstream panel |
| `/api/dependencies/nodes` | `GET` | — | Node picker list |
| `/api/dependencies/nodes` | `POST` | `{ id, name, type, layer, platform?, health, metrics }` | Add custom node |
| `/api/dependencies/edges` | `POST` | `{ source, target, relationship }` | Add edge |
| `/api/dependencies/edges` | `PUT` | `{ source, target, relationship }` | Update edge |
| `/api/dependencies/edges` | `DELETE` | `?source=&target=` | Remove edge |
| `/api/dependencies/nodes/{id}/logs` | `GET` | `?health=` | Node log panel |
| `/api/monitoring/node-metrics/{nodeId}` | `GET` | `?window=30` | NodeMetricsPanel sparklines |
| `/api/dependencies/upload/csv` | `POST` | multipart file | Bulk import |
| `/api/dependencies/upload/json` | `POST` | `{ source, target, relationship }` | Single edge import |

### View Values

`data_center`, `rack`, `server`, `business_service`, `application`, `microservice`, `infrastructure`, `on-prem-vmware`, `on-prem-physical`, `aws`, `gcp`, `azure`

### Heatmap Values

`latency`, `traffic`, `errors`, `saturation`, `cpu`, `memory`, `storage`, `io`, `network`, `error_rate`, `incident_count`, `risk_score`

### NodeMetrics Response

```json
{
  "node_id": "",
  "window_minutes": 30,
  "series": {
    "cpu": [{ "t": 0, "v": 45.2 }],
    "memory": [],
    "latency": [],
    "error_rate": []
  }
}
```

**InlineCopilot:** `POST /api/copilot/chat` (see §18)

---

## 7. Distributed Traces (`/traces`)

| API | Method | Query | Response |
|-----|--------|-------|----------|
| `/api/vm/traces/spans` | `GET` | `trace_id={id}` | Flat span list |

```json
{
  "trace_id": "gw0120210304000517192504",
  "span_count": 9,
  "source": "vm_otlp",
  "spans": [{
    "traceId": "",
    "spanId": "",
    "parentSpanId": null,
    "name": "POST /authorize",
    "service": "payment-authorization",
    "kind": "SERVER",
    "status": "OK",
    "startTimeMs": 1710000000000,
    "endTimeMs": 1710000000120,
    "durationMs": 120,
    "attributes": { "http.method": "POST" }
  }]
}
```

**Legacy proxy (not used by UI):** `GET /api/vm/traces/get_trace_by_id?trace_id=`

**OTLP ingest (backend only):** `POST /api/otel/v1/traces`

---

## 8. Incident Explorer (`/incidents`)

| API | Method | Query/Body | Purpose |
|-----|--------|------------|---------|
| `/api/vm/incidents` | `GET` | `?cmdb_id=&status=&limit=` | Main incident table (bank format) |
| `/api/incidents/` | `GET` | `?limit&offset&severity&service&search&state&active` | Intelligence-format list |
| `/api/incidents/{id}` | `GET` | — | Single incident detail |
| `/api/incidents/{id}/analysis` | `GET` | — | Click analysis (RCA/fix summary) |
| `/api/incidents/{id}/change-requests` | `GET` | — | Jira/change tickets |
| `/api/incidents/{id}/telemetry` | `GET` | — | Golden signals, host saturation |
| `/api/incidents/{id}/slo-burn` | `GET` | `?slo_target=99.9` | SLO burn chart |
| `/api/incidents/{id}/runbook` | `GET` | — | Runbook steps |
| `/api/incidents/{id}/resolve` | `PATCH` | `{ "resolution_notes": "" }` | Resolve action |
| `/api/rca/window` | `POST` | `{ t_start, t_end, num_failures?, use_traces?, use_llm? }` | Time-window RCA |
| `/api/rca/incident-telemetry` | `GET` | `?t_start=&t_end=&entities=` | Entity metrics in window |
| `/api/agents/incident-chat` | `POST` | `{ incident_id, question, history[] }` | Incident chat |
| `/api/agents/incident-chat/{id}/memory` | `DELETE` | — | Clear chat memory |

**Gate:** `GET /api/vm/incidents` → `dataset_available: true`

### BankIncident (Required for Table + Detail Panel)

```json
{
  "incidentId": "INC-0001",
  "title": "Payment latency spike",
  "description": "",
  "severity": "High",
  "status": "Open",
  "productName": "Payments",
  "owner": { "assignedTo": "SRE", "email": "sre@bank.com" },
  "createdTime": "2024-01-01T10:00:00Z",
  "lastUpdateTime": "2024-01-01T11:00:00Z",
  "timeWindow": { "start": "", "end": "" },
  "alerts": {
    "count": 3,
    "items": [{
      "alertId": "A1",
      "alertRule": "svc-payment-authorization-CPU",
      "severity": "Sev1",
      "signalType": "Metric",
      "firedAt": "ISO",
      "description": ""
    }]
  },
  "evidence": { "alertCount": 3, "eventCount": 10, "bookmarkCount": 0 },
  "entities": ["payment-authorization", "postgres-cluster"],
  "tactics": ["Performance"],
  "queryIndex": "",
  "taskType": "",
  "rcaStatus": "Pending"
}
```

### RCAWindowResponse

```json
{
  "results": [{
    "timestamp": 1710000000,
    "component": "payment-authorization",
    "reason": "",
    "confidence": 0.85,
    "evidence": [""],
    "datetime_utc8": "",
    "llm_analysis": ""
  }],
  "window_start": 0,
  "window_end": 0,
  "analysis_time_ms": 1200
}
```

**VM ingest:** `POST /api/vm/ingest/incidents`

---

## 9. RCA Dashboard (`/rca`)

| API | Method | Query | Purpose |
|-----|--------|-------|---------|
| `/api/vm/incidents` | `GET` | `?limit=` | Incident picker list |

Displays `BankIncident` fields: `incidentId`, `title`, `severity`, `status`, `entities`, `rcaStatus`.

---

## 10. Blast Radius (`/blast-radius`)

| API | Method | Body/Query | Purpose |
|-----|--------|------------|---------|
| `/api/dependencies/graph` | `GET` | `view=microservice&heatmap=risk_score` | Service picker + graph |
| `/api/blast-radius/analyze` | `POST` | see below | Impact analysis |
| `/api/blast-radius/chat-investigate` | `POST` | `{ service, question, history[] }` | Path chat |

### POST /api/blast-radius/analyze Body

```json
{
  "alerts": ["CPU Saturation", "API Error Spike"],
  "symptoms": ["Latency Increase"],
  "source_component": "payment-authorization",
  "service": "payment-authorization"
}
```

### BlastRadiusResult Response

```json
{
  "dataset_available": true,
  "currently_impacted_services": ["payment-authorization"],
  "likely_downstream_services": ["notification-service"],
  "impacted_infrastructure": ["postgres-cluster"],
  "impacted_customers_estimate": 12000,
  "impacted_regions": ["us-east"],
  "issue_scope": "localized",
  "business_impact_score": 7.5,
  "severity_recommendation": "Sev1",
  "blast_radius_nodes": ["payment-authorization", "postgres-cluster"],
  "highlight_edges": [{ "source": "payment-authorization", "target": "postgres-cluster" }]
}
```

---

## 11. Early Detection (`/early-detection`)

| API | Method | Body | Purpose |
|-----|--------|------|---------|
| `/api/early-detection/analyze` | `GET` or `POST` | POST: `{ "current_alerts": ["CPU Saturation"] }` | Full detection dashboard |
| `/api/incidents/` | `GET` | `?service={svcId}&limit=10` | Historical incidents per service |
| `/api/copilot/chat` | `POST` | `{ context, messages[] }` | Scoped copilot |

**Gate:** `analysis_ready: true` AND `dataset_available: true`. Without RCA pattern library + dependency graph, backend returns `analysis_ready: false`.

### Full Response Shape

```json
{
  "dataset_available": true,
  "analysis_ready": true,
  "source": "vm_push",
  "current_conditions": ["CPU Saturation", "API Error Spike"],
  "active_conditions": [{
    "title": "", "count": 5, "severity": "critical", "entities": [""]
  }],
  "active_alerts_feed": [{
    "id": "", "title": "", "severity": "", "status": "", "entity_id": "",
    "description": "", "metric": "", "value": 0, "threshold": 0,
    "minutes_ago": 0, "remediation_hints": []
  }],
  "critical_alerts_feed": [],
  "clearance_plan": { "steps": [], "eta_minutes": 0 },
  "detections": [{
    "pattern_id": "PAT-001",
    "pattern_label": "Payment cascade failure",
    "status": "probable_incident_forming",
    "progression_stage": "forming",
    "confidence": 78,
    "risk_level": "high",
    "match_coverage": {
      "matched": 3, "total": 5, "percent": 60, "unmatched_alerts": []
    },
    "matched_alerts": ["CPU Saturation"],
    "matched_alerts_details": [{
      "id": "", "title": "", "pattern_alert": "", "entity_id": "",
      "severity": "", "minutes_ago": 0, "match_score": 0,
      "value": 0, "threshold": 0, "metric": ""
    }],
    "propagation_paths": { "payment-authorization": ["postgres-cluster"] },
    "expected_symptoms": ["Latency Increase"],
    "expected_impacted_service": "Payment Authorization",
    "expected_impacted_service_id": "payment-authorization",
    "estimated_time_to_incident_minutes": 45,
    "occurrence_count_historical": 3,
    "recommended_actions": ["Scale payment pods"],
    "evidence_collection_plan": [""],
    "correlated_changes": [{
      "type": "", "id": "", "title": "", "status": "",
      "time": "", "severity": "", "hours_ago": 0
    }],
    "severity_breakdown": { "critical": 1, "warning": 2, "info": 0 }
  }],
  "total_patterns_evaluated": 12,
  "service_risk_summary": [{
    "service_id": "payment-authorization",
    "service_name": "Payment Authorization",
    "risk_level": "high",
    "confidence": 78,
    "active_threats": 2,
    "eta_minutes": 45,
    "progression_stage": "advancing"
  }],
  "summary": {
    "active_alerts": 24000,
    "critical_alerts": 120,
    "patterns_matched": 2,
    "imminent_threats": 1,
    "highest_risk_service": "Payment Authorization",
    "soonest_eta_minutes": 30
  },
  "analysis_timestamp": "ISO"
}
```

**VM ingest:** `POST /api/vm/ingest/early-detection` (bypasses pattern-library requirement)

### Alert Format for Engine

```json
{
  "id": "ALT-001",
  "title": "CPU Saturation",
  "severity": "critical",
  "status": "open",
  "entity_id": "payment-authorization",
  "triggered_at": "ISO",
  "description": "",
  "metric": "cpu_usage",
  "value": 95.2,
  "threshold": 80
}
```

---

## 12. Investigation Workflow (`/investigation`)

| API | Method | Body | Purpose |
|-----|--------|------|---------|
| `/api/dependencies/graph` | `GET` | `view=microservice&heatmap=risk_score` | Service list |
| `/api/investigations` | `POST` | `{ alerts[], symptoms[], service? }` | Start workflow |
| `/api/investigations/{id}` | `GET` | — | Poll state |
| `/api/investigations/{id}/advance` | `POST` | — | Step forward |
| `/api/investigations/{id}/approve` | `POST` | — | Human approval gate |
| `/api/investigations/{id}/execute` | `POST` | — | Simulated remediation |
| `/api/copilot/chat` | `POST` | `{ context, messages[] }` | Step explanations |

### Investigation Response

```json
{
  "id": "INV-abc123",
  "status": "in_progress",
  "current_step": "collect_metrics",
  "steps": [{
    "id": "collect_metrics",
    "label": "Collect Metrics",
    "status": "completed",
    "completed_at": "ISO"
  }],
  "recommended_fix": "Scale payment-authorization pods",
  "remediation_status": "pending",
  "remediation_simulated": true,
  "remediation_result": { "action": "", "status": "success", "message": "" },
  "rca_result": {},
  "blast_result": {},
  "input": { "alerts": [], "symptoms": [], "service": "payment-authorization" }
}
```

---

## 13. Cloud Integrations (`/integrations`)

| API | Method | Body/Query | Tab |
|-----|--------|------------|-----|
| `/api/integrations/connections` | `GET` | — | Connection list |
| `/api/integrations/aws/connect` | `POST` | `{ connection_name, region, access_key_id?, secret_access_key?, role_arn?, external_id? }` | Connect AWS |
| `/api/integrations/azure/connect` | `POST` | `{ connection_name, tenant_id, client_id, client_secret, subscription_id }` | Connect Azure |
| `/api/integrations/gcp/connect` | `POST` | `{ connection_name, project_id, credentials_json }` | Connect GCP |
| `/api/integrations/kubernetes/connect` | `POST` | `{ connection_name, kubeconfig }` | Connect K8s |
| `/api/integrations/connections/{id}` | `DELETE` | `?provider=aws\|azure\|gcp\|kubernetes` | Disconnect |
| `/api/integrations/sync` | `POST` | — | Sync all connections |
| `/api/integrations/resources` | `GET` | `?provider=&limit=500` | Resources tab |
| `/api/integrations/logs` | `GET` | `?provider=&limit=200` | Logs tab |
| `/api/integrations/traces` | `GET` | `?provider=&limit=100` | Traces tab |
| `/api/integrations/audit-events` | `GET` | `?provider=&limit=200` | Audit tab |
| `/api/integrations/config-compliance` | `GET` | `?provider=` | Compliance tab |

---

## 14. Ops Catalog (`/ops-config`)

| API | Method | Response |
|-----|--------|----------|
| `/api/ops/catalog` | `GET` | `{ entity_types[], integrations[], service_nav[], platform_nav[] }` |

---

## 15. Data Admin / Custom (`/admin`)

| API | Method | Body | Purpose |
|-----|--------|------|---------|
| `/api/admin/data-status` | `GET` | — | File inventory |
| `/api/admin/regenerate` | `POST` | — | Regenerate synthetic data |
| `/api/admin/upload/{category}` | `POST` | multipart file | Upload parquet/JSON by category |
| `/api/admin/upload-dataset` | `POST` | multipart ZIP | Full dataset |
| `/api/admin/upload-dataset-json` | `POST` | multipart JSON | Dataset JSON |
| `/api/admin/add-incident` | `POST` | `BankIncident` object | Manual incident |

---

## 16. Settings (`/settings`)

No backend APIs. All toggles and preferences are local React state only.

---

## 17. Service Detail (`/services/:serviceId`)

| API | Method | Query | Purpose |
|-----|--------|-------|---------|
| `/api/monitoring/dashboard` | `GET` | — | Service metrics from `service.services[]` matching `serviceId` |
| `/api/overview` | `POST` | — | Related incidents |
| `/api/dependencies/graph` | `GET` | `view=microservice&heatmap=latency&focus_node={serviceId}` | Focused topology |
| `/api/monitoring/timeseries` | `GET` | `metric=latency_p99&entity_id={serviceId}` | Latency chart |
| `/api/monitoring/timeseries` | `GET` | `metric=error_rate&entity_id={serviceId}` | Error chart |
| `/api/monitoring/timeseries` | `GET` | `metric=throughput_rps&entity_id={serviceId}` | Throughput chart |

---

## 18. Shared Copilot APIs

Used across Incident Explorer, Blast Radius, Early Detection, Investigation, Dependency Map, and inline copilot panels.

| API | Method | Body | Response |
|-----|--------|------|----------|
| `/api/copilot/chat` | `POST` | `{ "context": CopilotContextPayload, "messages": [{ "role", "content" }] }` | `CopilotResponse` |
| `/api/copilot/ask` | `POST` | `{ "question": "..." }` | `{ question, answer, sources[], suggested_actions[] }` |
| `/api/copilot/scoped` | `POST` | `{ context_type, context_payload, question, history[] }` | `{ answer, sources[], timestamp }` |

### CopilotContextPayload

```json
{
  "context_scope": "strict",
  "page_type": "service",
  "selected_entity": "payment-authorization",
  "entity_data": {},
  "related_metrics": {},
  "related_alerts": [],
  "related_incidents": [],
  "dependency_data": {},
  "analysis_results": {},
  "investigation_results": {},
  "user_question": ""
}
```

### CopilotResponse

```json
{
  "summary": "",
  "findings": [""],
  "evidence": [""],
  "recommended_actions": [""],
  "confidence": "high",
  "model": "",
  "agent": "",
  "timestamp": "ISO"
}
```

---

## 19. VM Read APIs (Shared Data Layer)

| API | Method | Query | Response |
|-----|--------|-------|----------|
| `/api/vm/incidents` | `GET` | `cmdb_id, status, limit, raw` | `VmIncidentsResponse` |
| `/api/vm/alerts` | `GET` | `state, limit, raw` | `VmAlertsResponse` |
| `/api/vm/traces/spans` | `GET` | `trace_id` | `VmTraceSpansResponse` |
| `/api/vm/status` | `GET` | — | `{ parquet_available, vm_data_available, keys, ingest_endpoints }` |

---

## 20. Additional Intelligence APIs

Available on the backend; used selectively by the UI.

| API | Method | Purpose |
|-----|--------|---------|
| `/api/rca/analyze` | `POST` | Signal-based RCA |
| `/api/rca/agent-analyze` | `POST` | Agent RCA for incident click |
| `/api/knowledge-graph` | `GET` | Full knowledge graph |
| `/api/incidents/graph` | `GET` | Incident relationship graph |
| `/api/monitoring/alerts` | `GET` | `?limit=20` |
| `/api/monitoring/metrics` | `GET` | `?entity_id=&metric=` |
| `/api/monitoring/events` | `GET` | `?limit=50` |
| `/api/integrations/traces` | `GET` | Integration traces via `getIntegrationTraces()` |

---

## Quick Reference: Minimum VM Pushes for a Fully Populated UI

| UI Area | Minimum VM Push |
|---------|-----------------|
| Executive + Service/Platform overview KPIs | `POST /api/vm/ingest/monitoring/dashboard` |
| Ops section tables | `POST /api/vm/ingest/ops/sections` per `derive_key` |
| Entity drawer | `POST /api/vm/ingest/ops/entities` + parquet telemetry |
| Dependency map | `POST /api/vm/ingest/dependencies/graph` |
| Incidents | `POST /api/vm/ingest/incidents` OR MinIO `incidents.parquet` |
| Traces | OTLP → `POST /api/otel/v1/traces` OR VM `:8080` proxy |
| Early Detection | `POST /api/vm/ingest/early-detection` OR pattern library + dep graph + alerts |
| Trend charts | `POST /api/vm/ingest/timeseries` per metric |
| Notifications bell | `POST /api/vm/ingest/overview` |

---

## Unrouted Pages (Exist in Codebase, Not in Nav)

| Page | APIs |
|------|------|
| `HomeOverview.tsx` | Same as Executive Command Center |
| `CopilotPage.tsx` | `POST /api/copilot/ask` only |
| `MonitoringDashboard.tsx` | Redirects to `/operations` |

---

## Type Reference (Frontend)

Source files for TypeScript interfaces:

- `frontend/src/types/api.ts` — `MonitoringDashboard`, `DependencyGraph`, `GraphNode`
- `frontend/src/types/intelligence.ts` — `Incident`, `RCAResult`, `BlastRadiusResult`, `EarlyDetection`, `Investigation`, `Overview`
- `frontend/src/types/ops.ts` — `OpsEntity`, `OpsCatalog`, `OpsEntityTelemetry`
- `frontend/src/api/services/vm.ts` — `VmIncident`, `TraceSpan`
- `frontend/src/ai/types.ts` — `CopilotContextPayload`, `CopilotResponse`
