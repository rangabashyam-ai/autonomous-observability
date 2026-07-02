export type HealthStatus = 'healthy' | 'warning' | 'critical' | 'unknown';
export type OpsPerspective = 'service' | 'platform';

export interface OpsEntity {
  id: string;
  name: string;
  entity_type: string;
  layer?: string;
  health: HealthStatus;
  platform?: string;
  region?: string;
  parent_id?: string;
  owner?: string;
  metrics: Record<string, number | string>;
  metadata: Record<string, unknown>;
  relationships: string[];
}

export interface OpsSectionWidget {
  widget_type: string;
  title: string;
  entity_types?: string[];
  derive_key?: string;
  columns?: string[];
}

export interface OpsDashboardSection {
  id: string;
  label: string;
  description?: string;
  icon?: string;
  entity_types?: string[];
  widgets: OpsSectionWidget[];
}

export interface OpsDashboardDefinition {
  id: string;
  title: string;
  description: string;
  perspective: OpsPerspective;
  sections: OpsDashboardSection[];
}

export interface EntityTypeInfo {
  id: string;
  label: string;
  layer: string;
  perspective: OpsPerspective;
}

export interface OpsCatalog {
  entity_types: EntityTypeInfo[];
  integrations: string[];
  service_nav: { id: string; label: string }[];
  platform_nav: { id: string; label: string }[];
}

export interface OpsEntitiesResponse {
  entities: OpsEntity[];
  total: number;
  by_type: Record<string, number>;
}

export type OpsDashboardId = 'service-ops' | 'platform-ops';

export type EntityDrawerTab =
  | 'overview'
  | 'metrics'
  | 'dependencies'
  | 'topology'
  | 'logs'
  | 'traces'
  | 'events'
  | 'incidents'
  | 'deployments'
  | 'configuration'
  | 'security'
  | 'runbook';

export const ENTITY_DRAWER_TABS: { id: EntityDrawerTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'metrics', label: 'Metrics' },
  { id: 'dependencies', label: 'Dependencies' },
  { id: 'topology', label: 'Topology' },
  { id: 'logs', label: 'Logs' },
  { id: 'traces', label: 'Traces' },
  { id: 'events', label: 'Events' },
  { id: 'incidents', label: 'Incidents' },
  { id: 'deployments', label: 'Deployments' },
  { id: 'configuration', label: 'Configuration' },
  { id: 'security', label: 'Security' },
  { id: 'runbook', label: 'Runbook' },
];

export interface OpsEntityTelemetry {
  entity_id: string;
  entity_name: string;
  window: { start: string; end: string };
  dataset_available?: boolean;
  metrics: Array<{
    timestamp: string;
    request_rate: number;
    success_rate: number;
    request_count: number;
    mean_response_time: number;
  }>;
  host_metrics: Array<{
    timestamp: string;
    host: string;
    cpu: number;
  }>;
  logs: Array<{
    timestamp: string;
    host: string;
    log_name: string;
    message: string;
    severity: 'info' | 'error';
  }>;
  traces: Array<{
    trace_id: string;
    service: string;
    host: string;
    timestamp: string;
    has_parent: boolean;
  }>;
  log_error?: string;
  metric_error?: string;
  trace_error?: string;
}
