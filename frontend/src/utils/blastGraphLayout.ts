import { MarkerType, type Edge, type Node } from 'reactflow';
import type { BlastRadiusResult } from '../types/intelligence';
import type { DependencyGraph, GraphEdge, GraphNode } from '../types/api';

export type BlastImpactRole =
  | 'root'
  | 'impacted'
  | 'downstream'
  | 'upstream'
  | 'infrastructure'
  | 'at_risk'
  | 'context';

export type BlastEdgeKind = 'impact' | 'upstream' | 'dependency' | 'context';

const LAYER_COLUMNS: Record<string, number> = {
  business_service: 0,
  application: 1,
  microservice: 2,
  platform: 3,
  container: 3,
  server: 4,
  rack: 5,
  network: 6,
};

const INFRA_LAYERS = new Set(['platform', 'server', 'rack', 'network', 'container']);
const DB_TYPES = /database|postgres|redis|cassandra|kafka|cluster|queue/i;

export function isInfrastructureNode(node: GraphNode): boolean {
  return INFRA_LAYERS.has(node.layer) || DB_TYPES.test(node.type) || DB_TYPES.test(node.id);
}

export function computeDownstreamSet(rootId: string, edges: GraphEdge[]): Set<string> {
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

export function computeUpstreamSet(rootId: string, edges: GraphEdge[]): Set<string> {
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

export function classifyImpactRole(
  node: GraphNode,
  blast: BlastRadiusResult,
  rootId: string,
  upstreamSet: Set<string>,
  downstreamSet: Set<string>,
): BlastImpactRole {
  if (node.id === rootId) return 'root';

  const inBlast = blast.blast_radius_nodes.includes(node.id);
  if (!inBlast) return 'context';

  if (blast.impacted_infrastructure.includes(node.id) || isInfrastructureNode(node)) {
    return 'infrastructure';
  }
  if (blast.currently_impacted_services.includes(node.id)) return 'impacted';
  if (blast.likely_downstream_services.includes(node.id) || downstreamSet.has(node.id)) {
    return 'downstream';
  }
  if (upstreamSet.has(node.id)) return 'upstream';
  return 'at_risk';
}

export function layoutBlastNodes(nodes: GraphNode[]): Map<string, { x: number; y: number }> {
  const byColumn = new Map<number, GraphNode[]>();

  for (const node of nodes) {
    const col = LAYER_COLUMNS[node.layer] ?? (isInfrastructureNode(node) ? 3 : 2);
    const list = byColumn.get(col) ?? [];
    list.push(node);
    byColumn.set(col, list);
  }

  const positions = new Map<string, { x: number; y: number }>();
  const columnWidth = 200;
  const rowHeight = 110;

  for (const [col, colNodes] of byColumn) {
    const sorted = [...colNodes].sort((a, b) => a.label.localeCompare(b.label));
    const offsetY = ((sorted.length - 1) * rowHeight) / 2;
    sorted.forEach((node, row) => {
      positions.set(node.id, {
        x: col * columnWidth,
        y: row * rowHeight - offsetY,
      });
    });
  }

  return positions;
}

function edgeKey(source: string, target: string): string {
  return `${source}->${target}`;
}

export function resolveEdgeKind(
  edge: GraphEdge,
  blast: BlastRadiusResult,
  rootId: string,
  graphEdges: GraphEdge[],
): BlastEdgeKind {
  const upstreamSet = computeUpstreamSet(rootId, graphEdges);
  const downstreamSet = computeDownstreamSet(rootId, graphEdges);
  return classifyEdgeKind(edge, blast, rootId, upstreamSet, downstreamSet);
}

function classifyEdgeKind(
  edge: GraphEdge,
  blast: BlastRadiusResult,
  rootId: string,
  upstreamSet: Set<string>,
  downstreamSet: Set<string>,
): BlastEdgeKind {
  const inBlast =
    blast.blast_radius_nodes.includes(edge.source) && blast.blast_radius_nodes.includes(edge.target);
  if (!inBlast) return 'context';

  const isHighlight = blast.highlight_edges.some(
    (he) => he.source === edge.source && he.target === edge.target,
  );
  if (isHighlight) return 'impact';

  if (upstreamSet.has(edge.source) && (edge.target === rootId || downstreamSet.has(edge.target))) {
    return 'upstream';
  }
  if (
    edge.source === rootId ||
    downstreamSet.has(edge.source) ||
    blast.currently_impacted_services.includes(edge.source)
  ) {
    return 'impact';
  }
  if (edge.type === 'hierarchy' || edge.relationship === 'contains') return 'dependency';
  if (upstreamSet.has(edge.source)) return 'upstream';
  return 'dependency';
}

function relationshipLabel(relationship: string, kind: BlastEdgeKind): string {
  const rel = relationship.replace(/_/g, ' ');
  if (kind === 'impact') return `▶ ${rel}`;
  if (kind === 'upstream') return `◀ ${rel}`;
  return rel;
}

export function buildBlastFlowEdges(
  graphEdges: GraphEdge[],
  blast: BlastRadiusResult,
  rootId: string,
  theme: 'light' | 'dark',
  selectedEdgeId?: string | null,
): Edge[] {
  const upstreamSet = computeUpstreamSet(rootId, graphEdges);
  const downstreamSet = computeDownstreamSet(rootId, graphEdges);

  // Trace BFS sequence of failure propagation for 'impact' edges
  const propagationEdges: GraphEdge[] = [];
  const queue = [rootId];
  const visitedNodes = new Set<string>([rootId]);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const outgoing = graphEdges
      .filter(e => e.source === current)
      .map(e => {
        const kind = classifyEdgeKind(e, blast, rootId, upstreamSet, downstreamSet);
        return { edge: e, kind };
      })
      .filter(x => x.kind === 'impact' && !visitedNodes.has(x.edge.target));
    
    // Sort outgoing edges deterministically by target ID
    outgoing.sort((a, b) => a.edge.target.localeCompare(b.edge.target));

    for (const x of outgoing) {
      visitedNodes.add(x.edge.target);
      propagationEdges.push(x.edge);
      queue.push(x.edge.target);
    }
  }

  const impactColor = theme === 'light' ? '#dc2626' : '#f87171';
  const upstreamColor = theme === 'light' ? '#4f46e5' : '#818cf8';
  const dependencyColor = theme === 'light' ? '#94a3b8' : '#64748b';
  const contextColor = theme === 'light' ? '#cbd5e1' : '#475569';

  const seen = new Set<string>();
  const flowEdges: Edge[] = [];

  graphEdges.forEach((edge, i) => {
    const kind = classifyEdgeKind(edge, blast, rootId, upstreamSet, downstreamSet);
    const key = edgeKey(edge.source, edge.target);
    if (seen.has(key)) return;
    seen.add(key);

    const palette = {
      impact: { stroke: impactColor, width: 2.5, animated: true, dash: undefined },
      upstream: { stroke: upstreamColor, width: 2, animated: false, dash: '6 4' },
      dependency: { stroke: dependencyColor, width: 1.5, animated: false, dash: '4 4' },
      context: { stroke: contextColor, width: 1, animated: false, dash: undefined },
    }[kind];

    const edgeId = `be-${i}`;
    const isSelected = selectedEdgeId === edgeId;

    // Find sequence index
    const seqIndex = propagationEdges.findIndex(
      pe => pe.source === edge.source && pe.target === edge.target
    );
    const seqNumber = seqIndex !== -1 ? seqIndex + 1 : undefined;

    const flowEdge: Edge = {
      id: edgeId,
      source: edge.source,
      target: edge.target,
      type: 'blastRadiusEdge',
      animated: palette.animated,
      selected: isSelected,
      interactionWidth: 20,
      className: palette.animated ? 'animated' : undefined,
      style: {
        stroke: palette.stroke,
        strokeWidth: isSelected ? palette.width + 2 : palette.width,
        strokeDasharray: palette.dash,
        opacity: kind === 'context' ? 0.35 : 1,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: palette.stroke,
        width: 16,
        height: 16,
      },
      data: { kind, relationship: edge.relationship, seqNumber },
    };

    if (kind !== 'context') {
      flowEdge.label = relationshipLabel(edge.relationship, kind);
      flowEdge.labelStyle = {
        fill: palette.stroke,
        fontSize: 9,
        fontWeight: kind === 'impact' ? 600 : 400,
      };
      flowEdge.labelBgStyle = {
        fill: theme === 'light' ? '#f8fafc' : '#0f172a',
        fillOpacity: 0.92,
      };
      flowEdge.labelBgPadding = [4, 6];
      flowEdge.labelBgBorderRadius = 4;
    }

    flowEdges.push(flowEdge);
  });

  return flowEdges;
}

export function buildBlastFlowNodes(
  graph: DependencyGraph,
  blast: BlastRadiusResult,
  rootId: string,
  focusedNodeId: string | null,
): Node[] {
  const upstreamSet = computeUpstreamSet(rootId, graph.edges);
  const downstreamSet = computeDownstreamSet(rootId, graph.edges);
  const positions = layoutBlastNodes(graph.nodes);

  return graph.nodes.map((node) => {
    const impactRole = classifyImpactRole(node, blast, rootId, upstreamSet, downstreamSet);
    const pos = positions.get(node.id) ?? { x: 0, y: 0 };

    return {
      id: node.id,
      type: 'blastRadius',
      position: pos,
      data: {
        label: node.label,
        layer: node.layer,
        type: node.type,
        health: node.health,
        impactRole,
        isSelected: node.id === focusedNodeId,
        riskScore: node.heatmap_value,
      },
    };
  });
}

export function mergeDependencyGraphs(...graphs: DependencyGraph[]): DependencyGraph {
  const nodeMap = new Map<string, GraphNode>();
  const edgeMap = new Map<string, GraphEdge>();

  for (const graph of graphs) {
    for (const node of graph.nodes) nodeMap.set(node.id, node);
    for (const edge of graph.edges) edgeMap.set(edgeKey(edge.source, edge.target), edge);
  }

  const nodes = [...nodeMap.values()];
  return {
    view: graphs[0]?.view ?? 'microservice',
    heatmap: graphs[0]?.heatmap ?? 'risk_score',
    focus_node: graphs[0]?.focus_node ?? null,
    nodes,
    edges: [...edgeMap.values()],
    node_count: nodes.length,
    edge_count: edgeMap.size,
  };
}

export function filterGraphForBlast(graph: DependencyGraph, blast: BlastRadiusResult): DependencyGraph {
  const relevantIds = new Set([
    ...blast.blast_radius_nodes,
    ...blast.impacted_infrastructure,
  ]);

  const nodes = graph.nodes.filter(
    (n) => relevantIds.has(n.id) || blast.blast_radius_nodes.some((id) => graph.edges.some(
      (e) => (e.source === id && e.target === n.id) || (e.target === id && e.source === n.id),
    )),
  );
  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges = graph.edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));

  return { ...graph, nodes, edges, node_count: nodes.length, edge_count: edges.length };
}

export const IMPACT_ROLE_LABELS: Record<BlastImpactRole, string> = {
  root: 'Root Cause',
  impacted: 'Impacted',
  downstream: 'Downstream',
  upstream: 'Upstream Dep',
  infrastructure: 'Infrastructure',
  at_risk: 'At Risk',
  context: 'Unaffected',
};
