export interface NodeMetrics {
  cpu: number;
  memory: number;
  storage: number;
  io: number;
  network: number;
  latency: number;
  error_rate: number;
  incident_count: number;
  risk_score: number;
}

export interface GraphNode {
  id: string;
  label: string;
  type: string;
  layer: string;
  health: 'healthy' | 'warning' | 'critical';
  metrics: NodeMetrics;
  heatmap_value: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  relationship: string;
  type: string;
}

export interface DependencyGraph {
  view: string;
  heatmap: string;
  focus_node: string | null;
  nodes: GraphNode[];
  edges: GraphEdge[];
  node_count: number;
  edge_count: number;
}

export interface DependencyPath {
  node_id: string;
  node: Record<string, unknown>;
  upstream: { node: string; relationship: string }[];
  downstream: { node: string; relationship: string }[];
}

export interface ExecutiveMetrics {
  service_availability: number;
  transaction_success_rate: number;
  sla_compliance: number;
  revenue_impact_usd: number;
  customer_impact_count: number;
  services_at_risk: number;
  active_incidents: number;
}

export interface ServiceMetric {
  id: string;
  name: string;
  health: string;
  latency_p99_ms: number;
  error_rate: number;
  throughput_rps: number;
  transaction_volume: number;
  availability: number;
}

export interface MonitoringDashboard {
  executive: ExecutiveMetrics;
  service: { services: ServiceMetric[] };
  technical: {
    containers: { id: string; status: string; cpu: number; memory: number }[];
    apis: { name: string; latency_ms: number; error_rate: number; requests_per_sec: number }[];
    databases: { id: string; connections: number; query_latency_ms: number; replication_lag_ms: number }[];
    queues: { id: string; depth: number; consumer_lag: number; throughput_msg_s: number }[];
    jvm: { service: string; heap_used_pct: number; thread_count: number; gc_pause_ms: number }[];
  };
  infrastructure: {
    summary: {
      avg_cpu: number;
      avg_memory: number;
      avg_storage: number;
      avg_network: number;
      avg_io: number;
    };
    servers: {
      id: string;
      cpu: number;
      memory: number;
      storage: number;
      network: number;
      io: number;
    }[];
  };
}

export type ViewType =
  | 'data_center'
  | 'rack'
  | 'server'
  | 'business_service'
  | 'application'
  | 'microservice'
  | 'infrastructure';

export type HeatmapMetric =
  | 'cpu'
  | 'memory'
  | 'storage'
  | 'io'
  | 'network'
  | 'latency'
  | 'error_rate'
  | 'incident_count'
  | 'risk_score';
