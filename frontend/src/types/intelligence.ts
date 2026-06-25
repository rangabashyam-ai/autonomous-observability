export interface Incident {
  incident_id: string;
  title: string;
  severity: string;
  state?: string;
  service: string;
  service_id?: string;
  alerts: string[];
  symptoms: string[];
  root_cause: string;
  fix: string;
  impacted_components: string[];
  impacted_services?: string[];
  region: string;
  environment: string;
  owner_team: string;
  start_time: string;
  end_time: string;
  duration_minutes?: number;
  resolution_notes?: string;
  similar_incidents?: string[];
  change_records?: { id: string; title: string; hours_before_incident: number; risk: string }[];
  confidence_training_value?: number;
  // Hidden enrichment fields from CSV — present in API, not rendered in UI
  original_id?: string;
  true_root_cause?: string;
  component?: string;
  incident_time?: string;
  details?: string;
}

export interface ComponentMetrics {
  cpu?: number;
  memory?: number;
  storage?: number;
  io?: number;
  network?: number;
  latency?: number;
  error_rate?: number;
  incident_count?: number;
  risk_score?: number;
}

export interface RCACandidate {
  root_cause: string;
  confidence: number;
  matching_incident_count: number;
  similar_incidents: string[];
  suggested_fixes: string[];
  evidence: { incident_id: string; title: string; alert_overlap: string[]; symptom_overlap: string[] }[];
}

export interface RCAResult {
  input: Record<string, unknown>;
  root_cause_candidates: RCACandidate[];
  similar_historical_incidents: { incident_id: string; title: string; root_cause: string; fix: string; severity: string }[];
  suggested_fix_playbook: string[];
  related_alerts_to_check: string[];
  related_symptoms_to_check: string[];
  relevant_recent_changes: { id: string; title: string; risk: string; status: string }[];
  dependency_path: string[];
  suspected_component: string | null;
}

export interface BlastRadiusResult {
  currently_impacted_services: string[];
  likely_downstream_services: string[];
  impacted_infrastructure: string[];
  impacted_customers_estimate: number;
  impacted_regions: string[];
  issue_scope: string;
  business_impact_score: number;
  severity_recommendation: string;
  blast_radius_nodes: string[];
  highlight_edges: { source: string; target: string }[];
  input?: { alerts?: string[]; symptoms?: string[]; source_component?: string };
}

export interface EarlyDetection {
  pattern_id: string;
  status: string;
  confidence: number;
  matched_alerts: string[];
  expected_symptoms: string[];
  expected_impacted_service: string;
  estimated_time_to_incident_minutes: number;
  recommended_actions: string[];
  evidence_collection_plan: string[];
  occurrence_count_historical?: number;
}

export interface InvestigationStep {
  id: string;
  label: string;
  status: string;
  completed_at: string | null;
}

export interface Investigation {
  id: string;
  status: string;
  current_step: string;
  steps: InvestigationStep[];
  recommended_fix: string;
  remediation_status: string;
  remediation_simulated?: boolean;
  remediation_result?: { action: string; status: string; message: string };
  rca_result?: RCAResult;
  blast_result?: BlastRadiusResult;
}

export interface Overview {
  summary: {
    total_incidents: number;
    active_incidents: number;
    open_alerts: number;
    knowledge_graph_nodes: number;
    knowledge_graph_edges: number;
    early_warnings: number;
    active_investigations: number;
  };
  recent_incidents: { incident_id: string; title: string; severity: string; service: string; root_cause: string }[];
  top_root_causes: { root_cause: string; count: number }[];
  early_detections: EarlyDetection[];
  open_alerts_preview: { title: string; severity: string; entity_id: string }[];
}

export interface IncidentClickAnalysis {
  type: 'fix_summary' | 'incident_rca' | 'cautionary_rca' | 'error';
  incident_id: string;
  analysis_timestamp?: string;
  // fix_summary (Closed)
  root_cause?: string;
  applied_fix?: string;
  resolution_notes?: string;
  resolved_at?: string;
  duration_minutes?: number;
  impacted_components?: string[];
  change_records?: { id: string; title: string; hours_before_incident: number; risk: string }[];
  // incident_rca + cautionary_rca shared
  agent?: string;
  primary_component?: string;
  dependency_path?: string[];
  component_metrics?: Record<string, ComponentMetrics>;
  anomalous_components?: Record<string, string[]>;
  reasoning?: string;
  // incident_rca only
  root_cause_candidates?: { root_cause: string; confidence: number; matching_incident_count: number; suggested_fixes: string[] }[];
  suggested_fix?: string;
  // cautionary_rca only
  caution_level?: 'low' | 'medium' | 'high';
  post_fix_incidents?: { incident_id: string; title: string; root_cause: string; service: string; start_time: string }[];
  path_alerts?: { title: string; severity: string; entity_id: string; metric: string; value?: number }[];
  recommendations?: string[];
  // LLM deep analysis (present when GROQ_API_KEY is configured)
  llm_analysis?: string | null;
  llm_model?: string;
  llm_error?: string;
  // Pre-built chat context from backend agents (compact, optimised for chat)
  chat_context?: string;
}

export interface RunbookStep {
  id: string;
  step: number;
  category: 'diagnose' | 'mitigate' | 'verify' | 'resolve';
  action: string;
  evidence: string;
  lever: string | null;
  confidence: 'high' | 'medium' | 'low';
}

export interface GoldenSignalWindow {
  sr_avg: number;
  sr_min: number;
  mrt_avg: number;
  mrt_max: number;
  rr_avg: number;
  cnt_total: number;
}

export interface IncidentRunbook {
  incident_id: string;
  golden_signals: {
    baseline: GoldenSignalWindow | null;
    incident: GoldenSignalWindow | null;
    deltas: { sr_pp: number; mrt_ms: number; rr_pct: number };
  };
  host_saturation: Array<{
    host: string;
    cpu_avg: number;
    cpu_peak: number;
    status: 'healthy' | 'degraded' | 'critical';
  }>;
  gc_pressure: boolean;
  runbook: RunbookStep[];
  similar_incidents: Array<{
    incident_id: string;
    fix: string;
    root_cause: string;
    service: string;
  }>;
}

export interface SloBurnAlert {
  tier: 'P0' | 'P1' | 'P2' | 'P3';
  firing: boolean;
  primary_window: string;
  confirmation_window: string;
  primary_burn_rate: number;
  confirmation_burn_rate: number;
  threshold: number;
  budget_consumed_pct: number;
}

export interface ServiceSloBurn {
  service: string;
  highest_firing_tier: 'P0' | 'P1' | 'P2' | 'P3' | null;
  time_to_exhaustion_hours: number | null;
  max_burn_rate: number;
  burn_rates: Record<string, number>;
  window_details: Record<string, { error_rate_pct: number; burn_rate: number; data_points: number }>;
  alerts: SloBurnAlert[];
}

export interface IncidentSloBurn {
  slo_target: number;
  error_budget_pct: number;
  error_budget_minutes: number;
  overall_highest_tier: 'P0' | 'P1' | 'P2' | 'P3' | null;
  recommended_action: string;
  services: ServiceSloBurn[];
}

export interface IncidentTelemetry {
  service: string;
  window: { start: string; end: string };
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

export interface KnowledgeGraph {
  nodes: { id: string; type: string; label: string }[];
  edges: {
    source: string;
    target: string;
    relationship: string;
    frequency: number;
    confidence: number;
    incident_refs: string[];
  }[];
  stats: Record<string, number>;
}
