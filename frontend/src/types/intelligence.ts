export interface Incident {
  incident_id: string;
  title: string;
  severity: string;
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
