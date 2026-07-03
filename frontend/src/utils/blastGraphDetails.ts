import type { BlastRadiusResult } from '../types/intelligence';
import type { DependencyGraph, GraphEdge, GraphNode } from '../types/api';
import {
  IMPACT_ROLE_LABELS,
  type BlastEdgeKind,
  type BlastImpactRole,
  classifyImpactRole,
  isInfrastructureNode,
} from './blastGraphLayout';

function computeDownstreamSet(rootId: string, edges: GraphEdge[]): Set<string> {
  const downstream = new Set<string>();
  const queue = [rootId];
  const visited = new Set<string>([rootId]);
  while (queue.length) {
    const current = queue.shift()!;
    for (const edge of edges) {
      if (edge.source === current && !visited.has(edge.target)) {
        visited.add(edge.target);
        downstream.add(edge.target);
        queue.push(edge.target);
      }
    }
  }
  return downstream;
}

function computeUpstreamSet(rootId: string, edges: GraphEdge[]): Set<string> {
  const upstream = new Set<string>();
  const queue = [rootId];
  const visited = new Set<string>([rootId]);
  while (queue.length) {
    const current = queue.shift()!;
    for (const edge of edges) {
      if (edge.target === current && !visited.has(edge.source)) {
        visited.add(edge.source);
        upstream.add(edge.source);
        queue.push(edge.source);
      }
    }
  }
  return upstream;
}

export function getNodeNeighbors(
  nodeId: string,
  edges: GraphEdge[],
): { upstream: { id: string; relationship: string }[]; downstream: { id: string; relationship: string }[] } {
  const upstream: { id: string; relationship: string }[] = [];
  const downstream: { id: string; relationship: string }[] = [];
  for (const edge of edges) {
    if (edge.target === nodeId) upstream.push({ id: edge.source, relationship: edge.relationship });
    if (edge.source === nodeId) downstream.push({ id: edge.target, relationship: edge.relationship });
  }
  return { upstream, downstream };
}

function labelFor(id: string, nodeMap: Map<string, GraphNode>): string {
  return nodeMap.get(id)?.label ?? id;
}

function whyAffected(
  role: BlastImpactRole,
  rootId: string,
  blast: BlastRadiusResult,
): string {
  switch (role) {
    case 'root':
      return `This is the suspected origin of the incident. Alerts (${blast.currently_impacted_services.length > 0 ? 'active' : 'monitored'}) triggered analysis starting here.`;
    case 'impacted':
      return `Directly within the blast radius of "${rootId}". Failure or degradation propagates here through active dependency paths.`;
    case 'downstream':
      return `Downstream of the root cause — receives traffic, data, or events from impacted upstream services and is likely to fail next.`;
    case 'upstream':
      return `Upstream dependency of the failure origin. Stress or retry storms from the incident may overload this component.`;
    case 'infrastructure':
      return `Shared infrastructure (database, cluster, or platform) used by impacted services — resource contention spreads impact here.`;
    case 'at_risk':
      return `Within the computed blast radius but not yet showing symptoms. Monitor for cascading failures.`;
    default:
      return `Not currently in the blast radius. Shown for topology context only.`;
  }
}

function whyHealthy(
  node: GraphNode,
  role: BlastImpactRole,
  rootId: string,
): string {
  const riskNote =
    node.heatmap_value < 40
      ? 'Risk score is low and within normal operating range.'
      : 'Risk score is moderate but health checks are passing.';

  if (role === 'context') {
    return `Operating normally — outside the incident blast radius. No dependency path from "${rootId}" is carrying active failure signals. ${riskNote} SLA and error budgets appear intact.`;
  }

  if (role === 'upstream' || role === 'at_risk') {
    return `Health checks are passing and no critical alerts are firing yet. ${riskNote} However, this component is coupled to the incident topology — continue monitoring for latency spikes or retry pressure from "${rootId}".`;
  }

  return `All health indicators are green. ${riskNote} This component is not on an active impact propagation path from the current root cause.`;
}

function currentImpact(role: BlastImpactRole, node: GraphNode, blast: BlastRadiusResult): string {
  if (role === 'context' && node.health === 'healthy') {
    return 'Operating normally — no incident impact detected on this component.';
  }
  if (node.health === 'healthy' && role !== 'root' && role !== 'impacted') {
    return `${IMPACT_ROLE_LABELS[role]} in topology, but health checks are currently passing. Watch for early warning signals.`;
  }
  if (role === 'context') return 'No active impact detected.';
  const healthNote =
    node.health === 'critical'
      ? 'Health status is critical.'
      : node.health === 'warning'
        ? 'Health status is degraded.'
        : 'Health may appear nominal while latency or errors rise.';
  const scope = blast.issue_scope === 'systemic' ? 'Part of a systemic outage.' : 'Localized impact zone.';
  return `${IMPACT_ROLE_LABELS[role]} component. ${healthNote} ${scope}`;
}

function buildStatusSection(
  node: GraphNode,
  role: BlastImpactRole,
  rootId: string,
  blast: BlastRadiusResult,
): { label: string; text: string } {
  const showHealthy =
    node.health === 'healthy' && role !== 'root' && role !== 'impacted';

  if (showHealthy) {
    return { label: 'Why healthy', text: whyHealthy(node, role, rootId) };
  }
  return { label: 'Why affected', text: whyAffected(role, rootId, blast) };
}

export interface BlastNodeDetail {
  id: string;
  label: string;
  layer: string;
  type: string;
  health: string;
  riskScore: number;
  impactRole: BlastImpactRole;
  impactRoleLabel: string;
  currentImpact: string;
  statusLabel: string;
  statusExplanation: string;
  rootCauseRelation: string;
  upstream: { id: string; label: string; relationship: string }[];
  downstream: { id: string; label: string; relationship: string }[];
  propagationDirection: string;
}

export function buildNodeDetail(
  node: GraphNode,
  graph: DependencyGraph,
  blast: BlastRadiusResult,
  rootId: string,
): BlastNodeDetail {
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));
  const upstreamSet = computeUpstreamSet(rootId, graph.edges);
  const downstreamSet = computeDownstreamSet(rootId, graph.edges);
  const role = classifyImpactRole(node, blast, rootId, upstreamSet, downstreamSet);
  const neighbors = getNodeNeighbors(node.id, graph.edges);

  let rootCauseRelation: string;
  if (node.id === rootId) {
    rootCauseRelation = 'This component is the analysis origin (root cause).';
  } else if (downstreamSet.has(node.id)) {
    rootCauseRelation = `Downstream of root cause "${labelFor(rootId, nodeMap)}" — impact flows toward this node.`;
  } else if (upstreamSet.has(node.id)) {
    rootCauseRelation = `Upstream of root cause "${labelFor(rootId, nodeMap)}" — may contribute to or amplify the failure.`;
  } else if (blast.blast_radius_nodes.includes(node.id)) {
    rootCauseRelation = `Connected to the incident blast radius around "${labelFor(rootId, nodeMap)}".`;
  } else {
    rootCauseRelation = 'Outside the active incident blast radius.';
  }

  let propagationDirection: string;
  if (node.id === rootId) {
    propagationDirection = 'Impact originates here and spreads downstream (→) along dependency edges.';
  } else if (role === 'downstream' || role === 'impacted') {
    propagationDirection = 'Impact arriving from upstream dependencies (left → right in the graph).';
  } else if (role === 'upstream') {
    propagationDirection = 'Reverse pressure possible — retries and load may flow back upstream (←).';
  } else if (role === 'infrastructure') {
    propagationDirection = 'Shared resource layer — multiple services pull impact into this layer.';
  } else {
    propagationDirection = 'No active propagation through this node.';
  }

  const status = buildStatusSection(node, role, rootId, blast);

  return {
    id: node.id,
    label: node.label,
    layer: node.layer,
    type: node.type,
    health: node.health,
    riskScore: node.heatmap_value,
    impactRole: role,
    impactRoleLabel: IMPACT_ROLE_LABELS[role],
    currentImpact: currentImpact(role, node, blast),
    statusLabel: status.label,
    statusExplanation: status.text,
    rootCauseRelation,
    upstream: neighbors.upstream.map((u) => ({
      id: u.id,
      label: labelFor(u.id, nodeMap),
      relationship: u.relationship,
    })),
    downstream: neighbors.downstream.map((d) => ({
      id: d.id,
      label: labelFor(d.id, nodeMap),
      relationship: d.relationship,
    })),
    propagationDirection,
  };
}

export interface BlastEdgeDetail {
  id: string;
  sourceId: string;
  targetId: string;
  sourceLabel: string;
  targetLabel: string;
  relationship: string;
  edgeType: string;
  kind: BlastEdgeKind;
  kindLabel: string;
  represents: string;
  propagationDirection: string;
  whyItMatters: string;
  rootCauseRelation: string;
}

const EDGE_KIND_LABELS: Record<BlastEdgeKind, string> = {
  impact: 'Impact propagation',
  upstream: 'Upstream dependency',
  dependency: 'Structural dependency',
  context: 'Topology link',
};

function edgeRepresents(kind: BlastEdgeKind, relationship: string): string {
  const rel = relationship.replace(/_/g, ' ');
  switch (kind) {
    case 'impact':
      return `Runtime dependency — "${rel}" — along which failure, latency, or errors are actively spreading.`;
    case 'upstream':
      return `Reverse dependency — "${rel}" — the target depends on the source; upstream stress can worsen the incident.`;
    case 'dependency':
      return `Structural link — "${rel}" — defines containment or hosting (not always a runtime call path).`;
    default:
      return `General topology link — "${rel}" — outside the active blast radius.`;
  }
}

export function buildEdgeDetail(
  edge: GraphEdge,
  kind: BlastEdgeKind,
  graph: DependencyGraph,
  blast: BlastRadiusResult,
  rootId: string,
  edgeId: string,
): BlastEdgeDetail {
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));
  const sourceLabel = labelFor(edge.source, nodeMap);
  const targetLabel = labelFor(edge.target, nodeMap);
  const rel = edge.relationship.replace(/_/g, ' ');

  let propagationDirection: string;
  if (kind === 'impact') {
    propagationDirection = `Failure propagates ${sourceLabel} → ${targetLabel} via "${rel}".`;
  } else if (kind === 'upstream') {
    propagationDirection = `Dependency flows ${sourceLabel} → ${targetLabel}; load may travel in reverse during incident.`;
  } else {
    propagationDirection = `Direction: ${sourceLabel} → ${targetLabel} (${rel}).`;
  }

  const isHighlight = blast.highlight_edges.some(
    (he) => he.source === edge.source && he.target === edge.target,
  );

  let whyItMatters: string;
  if (isHighlight) {
    whyItMatters = 'Primary incident propagation path identified by blast-radius analysis.';
  } else if (kind === 'impact') {
    whyItMatters = 'Both endpoints are in the blast radius — this path carries incident impact.';
  } else if (kind === 'upstream') {
    whyItMatters = 'Upstream coupling — failures here can starve or overload downstream services.';
  } else if (
    (nodeMap.get(edge.target) && isInfrastructureNode(nodeMap.get(edge.target)!)) ||
    (nodeMap.get(edge.source) && isInfrastructureNode(nodeMap.get(edge.source)!))
  ) {
    whyItMatters = 'Infrastructure coupling — shared resources amplify blast radius across services.';
  } else {
    whyItMatters = 'Structural relationship in the dependency map.';
  }

  let rootCauseRelation: string;
  if (edge.source === rootId) {
    rootCauseRelation = `Direct outbound path from root cause "${sourceLabel}".`;
  } else if (edge.target === rootId) {
    rootCauseRelation = `Inbound path to root cause "${targetLabel}" from upstream.`;
  } else if (blast.blast_radius_nodes.includes(edge.source) && blast.blast_radius_nodes.includes(edge.target)) {
    rootCauseRelation = 'Both endpoints are within the blast radius of the current incident.';
  } else {
    rootCauseRelation = 'Peripheral topology — not on the primary incident path.';
  }

  return {
    id: edgeId,
    sourceId: edge.source,
    targetId: edge.target,
    sourceLabel,
    targetLabel,
    relationship: edge.relationship,
    edgeType: edge.type,
    kind,
    kindLabel: EDGE_KIND_LABELS[kind],
    represents: edgeRepresents(kind, edge.relationship),
    propagationDirection,
    whyItMatters,
    rootCauseRelation,
  };
}
