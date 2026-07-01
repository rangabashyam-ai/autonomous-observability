import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as dagre from 'dagre';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  MarkerType,
  Handle,
  Position,
  type Node,
  type Edge,
  type ReactFlowInstance,
} from 'reactflow';
import 'reactflow/dist/style.css';

import DependencyNode from './DependencyNode';
import NodeMetricsPanel from './NodeMetricsPanel';
import {
  getDependencyGraph,
  getDependencyPaths,
  deleteDependency,
  addCustomNode,
  addDependency,
  listAllNodes,
} from '../api/client';
import type { DependencyGraph, DependencyPath, HeatmapMetric, ViewType } from '../types/api';
import { heatmapColor, healthBadgeClass, layerLabel } from '../utils/colors';
import { btnSecondary, btnPrimary } from './ui';
import { useLongPress } from '../utils/hooks';
import {
  buildHierarchicalSpecs,
  calcTreeLayout,
  flattenComputedLayout,
  getGroupLayoutedNodesDagre,
} from './layoutEngine';

const nodeTypes = { dependency: DependencyNode, nodeGroup: GroupNode };

const MAIN_VIEW_ITEMS: { id: ViewType; label: string }[] = [
  { id: 'business_service', label: 'Business Services' },
  { id: 'microservice', label: 'Microservices' },
];

const PLATFORM_VIEWS: { id: ViewType; label: string }[] = [
  { id: 'on-prem-vmware', label: 'On-Prem VMware' },
  { id: 'on-prem-physical', label: 'On-Prem Physical' },
  { id: 'aws', label: 'AWS' },
  { id: 'gcp', label: 'GCP' },
  { id: 'azure', label: 'Azure' },
];

// ── Replaced by layoutEngine.ts ───────────────────────────────────────────────

function buildFlow(
  graph: DependencyGraph,
  selectedNodeId: string | null,
  highlightIds: Set<string>,
  selectedViews: Set<ViewType>,
  onNodeLongPress: (id: string, isGroup: boolean) => void,
  onNodeShortClick: (id: string, isGroup: boolean) => void,
  onNodeDoubleClick: (id: string, label: string) => void,
): { nodes: Node[]; edges: Edge[] } {
  const rfEdges = buildEdges(graph, highlightIds);

  const hierarchicalSpecs = buildHierarchicalSpecs(graph, selectedViews);
  
  if (hierarchicalSpecs.length > 0 && selectedViews.size > 0) {
    const computedLayouts = calcTreeLayout(hierarchicalSpecs);
    const flattenedNodes = flattenComputedLayout(computedLayouts, graph, selectedNodeId, highlightIds);

    // Aggregate edges to roots to prevent arrow clutter
    const getRoot = (id: string): string => {
      let current = flattenedNodes.find(n => n.id === id);
      while (current && current.parentId) {
        current = flattenedNodes.find(n => n.id === current!.parentId);
      }
      return current ? current.id : id;
    };

    const edgeMap = new Map<string, Edge>();
    const isHighlighting = highlightIds.size > 0;

    rfEdges.forEach(e => {
      const srcRoot = getRoot(e.source);
      const tgtRoot = getRoot(e.target);
      if (srcRoot === tgtRoot) return;

      const isHighlighted = highlightIds.has(e.source) && highlightIds.has(e.target);
      const isDimmed = isHighlighting && !isHighlighted;

      const k = `${srcRoot}|${tgtRoot}`;
      if (!edgeMap.has(k)) {
        edgeMap.set(k, {
          id: `edge-${k}`,
          source: srcRoot,
          target: tgtRoot,
          type: 'smoothstep',
          markerEnd: { type: MarkerType.ArrowClosed, color: isHighlighted ? '#a855f7' : '#94a3b8' },
          style: { stroke: isHighlighted ? '#a855f7' : '#94a3b8', strokeWidth: 2, opacity: isDimmed ? 0.1 : 1 },
          animated: isHighlighted,
          hidden: isDimmed,
        });
      } else if (isHighlighted) {
        const existing = edgeMap.get(k)!;
        existing.animated = true;
        existing.hidden = false;
        existing.style = { stroke: '#a855f7', strokeWidth: 3, opacity: 1 };
        existing.markerEnd = { type: MarkerType.ArrowClosed, color: '#a855f7' };
      }
    });
    const aggregatedEdges = Array.from(edgeMap.values());

    const rfNodes = getGroupLayoutedNodesDagre(flattenedNodes, aggregatedEdges);

    // Drop edges that skip over intermediate group boxes — they produce crossing lines.
    // After Dagre assigns x-positions, any edge whose source and target have another
    // root group node between them on the x-axis is a crossing edge.
    const rootGroups = rfNodes.filter(n => !n.parentId).sort((a, b) => a.position.x - b.position.x);
    const nonCrossingEdges = aggregatedEdges.filter(e => {
      const src = rfNodes.find(n => n.id === e.source);
      const tgt = rfNodes.find(n => n.id === e.target);
      if (!src || !tgt) return true;
      const minX = Math.min(src.position.x, tgt.position.x);
      const maxX = Math.max(src.position.x, tgt.position.x);
      const hasBetween = rootGroups.some(
        n => n.id !== e.source && n.id !== e.target && n.position.x > minX + 10 && n.position.x < maxX - 10
      );
      return !hasBetween;
    });

    const finalNodes = rfNodes.map(n => ({
      ...n,
      data: {
        ...n.data,
        onLongPress: onNodeLongPress,
        onClick: onNodeShortClick,
        onDoubleClick: n.type === 'dependency' ? onNodeDoubleClick : undefined,
      }
    }));
    return { nodes: finalNodes, edges: nonCrossingEdges };
  }

  const raw = buildNodes(graph, selectedNodeId);
  return { nodes: getLayoutedNodes(raw, rfEdges), edges: rfEdges };
}

// ── Group Node Component ──────────────────────────────────────────────────────

function GroupNode({ id, data }: { id: string, data: { label: string; textColor: string, onLongPress?: (id: string, isGroup: boolean) => void, onClick?: (id: string, isGroup: boolean) => void } }) {
  const longPressProps = useLongPress(
    (e) => {
      e.stopPropagation();
      data.onLongPress?.(id, true);
    },
    (e) => {
      e.stopPropagation();
      data.onClick?.(id, true);
    },
    { delay: 400 }
  );

  return (
    <div {...longPressProps} className="w-full h-full" style={{ pointerEvents: 'auto', cursor: 'pointer' }}>
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <p style={{
        margin: 0,
        padding: '9px 14px 0',
        fontSize: 10,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.12em',
        color: data.textColor,
      }}>
        {data.label}
      </p>
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </div>
  );
}

const GOLDEN_SIGNALS: { id: HeatmapMetric; label: string; desc: string; accent: string }[] = [
  { id: 'latency',    label: 'Latency',    desc: 'Request response time — high latency = red',         accent: 'blue'   },
  { id: 'traffic',    label: 'Traffic',    desc: 'Demand on the system — very high load = red',         accent: 'purple' },
  { id: 'errors',     label: 'Errors',     desc: 'Request failure rate — high error rate = red',        accent: 'red'    },
  { id: 'saturation', label: 'Saturation', desc: 'Resource utilisation (CPU/disk) — near-full = red',  accent: 'orange' },
];

function buildNodes(graph: DependencyGraph, selectedId: string | null): Node[] {
  return graph.nodes.map((node) => {
    return {
      id: node.id,
      type: 'dependency',
      position: { x: 0, y: 0 },
      data: {
        label: node.label,
        type: node.type,
        layer: node.layer,
        health: node.health,
        heatmapValue: node.heatmap_value,
        heatmapMetric: graph.heatmap,
        isSelected: node.id === selectedId,
        isHighlighted: false,
        isSearchMatch: false,
        dimmed: false,
      },
    };
  });
}

function getLayoutedNodes(nodes: Node[], edges: Edge[], direction = 'LR'): Node[] {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));

  dagreGraph.setGraph({ rankdir: direction, nodesep: 60, ranksep: 120 });

  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: 80, height: 80 });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  const MAX_PER_COL = 6;
  const X_OFFSET = 120;
  const Y_GAP = 100;

  const sortedNodes = [...nodes].sort((a, b) => dagreGraph.node(a.id).x - dagreGraph.node(b.id).x);

  const groups: Node[][] = [];
  let currentGroup: Node[] = [];
  let currentX = -999999;

  sortedNodes.forEach((node) => {
    const pos = dagreGraph.node(node.id);
    if (pos.x - currentX > 100) {
      if (currentGroup.length > 0) groups.push(currentGroup);
      currentGroup = [node];
      currentX = pos.x;
    } else {
      currentGroup.push(node);
    }
  });
  if (currentGroup.length > 0) groups.push(currentGroup);

  let cumulativeXShift = 0;
  const finalPositions: Record<string, { x: number; y: number }> = {};

  groups.forEach((groupNodes) => {
    groupNodes.sort((a, b) => dagreGraph.node(a.id).y - dagreGraph.node(b.id).y);

    const subCols = Math.ceil(groupNodes.length / MAX_PER_COL);
    const baseX = dagreGraph.node(groupNodes[0].id).x + cumulativeXShift;

    let sumY = 0;
    groupNodes.forEach((n) => (sumY += dagreGraph.node(n.id).y));
    const avgY = sumY / groupNodes.length;

    groupNodes.forEach((node, idx) => {
      const subColIndex = Math.floor(idx / MAX_PER_COL);
      const rowIndex = idx % MAX_PER_COL;

      const finalX = baseX + subColIndex * X_OFFSET;
      const numInThisCol = Math.min(MAX_PER_COL, groupNodes.length - subColIndex * MAX_PER_COL);
      const startY = avgY - ((numInThisCol - 1) * Y_GAP) / 2;
      const finalY = startY + rowIndex * Y_GAP;

      finalPositions[node.id] = { x: finalX, y: finalY };
    });

    if (subCols > 1) {
      cumulativeXShift += (subCols - 1) * X_OFFSET;
    }
  });

  // Y-axis compaction to remove massive vertical gaps left by Dagre
  const yValues = Object.values(finalPositions).map((p) => p.y).sort((a, b) => a - b);
  const yBands: number[] = [];
  yValues.forEach((y) => {
    if (yBands.length === 0 || y - yBands[yBands.length - 1] > 50) {
      yBands.push(y);
    }
  });

  const compactYBands: Record<number, number> = {};
  let currentY = 0;
  yBands.forEach((bandY, i) => {
    compactYBands[bandY] = currentY;
    if (i < yBands.length - 1) {
      const originalDiff = yBands[i + 1] - bandY;
      currentY += Math.min(originalDiff, Y_GAP);
    }
  });

  Object.keys(finalPositions).forEach((id) => {
    const originalY = finalPositions[id].y;
    const bandY = yBands.find((b) => originalY >= b && originalY <= b + 50);
    if (bandY !== undefined) {
      finalPositions[id].y = compactYBands[bandY] + (originalY - bandY);
    }
  });

  return nodes.map((node) => {
    return {
      ...node,
      position: {
        x: finalPositions[node.id].x - 80 / 2,
        y: finalPositions[node.id].y - 80 / 2,
      },
      width: 80,
      height: 80,
    };
  });
}

function buildEdges(graph: DependencyGraph, highlightIds: Set<string>): Edge[] {
  const isHighlighting = highlightIds.size > 0;
  return graph.edges.map((e, i) => {
    const isHighlighted = highlightIds.has(e.source) && highlightIds.has(e.target);
    const isDimmed = isHighlighting && !isHighlighted;
    return {
      id: `e-${e.source}-${e.target}-${i}`,
      source: e.source,
      target: e.target,
      label: e.relationship,
      labelStyle: { fill: '#94a3b8', fontSize: 10 },
      animated: isHighlighted,
      hidden: isDimmed,
      style: {
        stroke: isHighlighted ? '#a855f7' : '#475569',
        strokeWidth: isHighlighted ? 2.5 : 1.5,
        opacity: isDimmed ? 0 : 1,
      },
      markerEnd: { type: MarkerType.ArrowClosed, color: '#64748b' },
    };
  });
}

function GroupDetailsPopup({ groupId, graph, nodes, heatmapMetric, onClose, onNodeSelect }: { groupId: string, graph: DependencyGraph, nodes: Node[], heatmapMetric: string, onClose: () => void, onNodeSelect: (id: string) => void }) {
  const children = nodes.filter(n => n.parentId === groupId);
  const childIds = new Set(children.map(c => c.id));
  const containedNodes = graph.nodes.filter(n => childIds.has(n.id));

  const [search, setSearch] = useState('');
  const filtered = containedNodes.filter(n => n.label.toLowerCase().includes(search.toLowerCase()) || n.type.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="fixed inset-y-0 right-0 w-[450px] bg-slate-50 dark:bg-[#0b1120] border-l border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col z-50 transform transition-transform duration-300">
      <div className="flex items-center justify-between px-6 py-5 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f172a]">
        <div>
          <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
            📦 Group Details
          </h3>
          <p className="text-xs font-medium tracking-wide text-slate-500 uppercase mt-1">
            {containedNodes.length} Components
          </p>
        </div>
        <button
          onClick={onClose}
          className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          ✕
        </button>
      </div>

      <div className="p-6 overflow-y-auto flex-1 space-y-4">
        <input 
          type="text" 
          placeholder="Filter components..." 
          className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        
        <div className="space-y-3">
          {filtered.map(node => (
            <div 
              key={node.id} 
              className="p-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl cursor-pointer hover:border-blue-500 transition-colors"
              onClick={() => onNodeSelect(node.id)}
            >
              <div className="flex justify-between items-center mb-2">
                <span className="font-semibold text-sm text-slate-900 dark:text-white">{node.label}</span>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                  node.health === 'healthy' ? 'bg-emerald-100 text-emerald-700' :
                  node.health === 'warning' ? 'bg-amber-100 text-amber-700' :
                  'bg-red-100 text-red-700'
                }`}>
                  {node.health.toUpperCase()}
                </span>
              </div>
              <div className="text-xs text-slate-500 mb-2">{node.type} • {node.layer}</div>
              <div className="flex justify-between items-center text-xs">
                <span className="text-slate-500">{heatmapMetric}</span>
                <span className="font-mono font-medium text-slate-700 dark:text-slate-300">
                  {typeof node.heatmap_value === 'number' ? node.heatmap_value.toFixed(1) : node.heatmap_value}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export default function DependencyMap() {
  const [selectedViews, setSelectedViews] = useState<Set<ViewType>>(new Set(['business_service']));
  const [platformExpanded, setPlatformExpanded] = useState(false);
  const [heatmap, setHeatmap] = useState<HeatmapMetric>('errors');
  const [graph, setGraph] = useState<DependencyGraph | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [paths, setPaths] = useState<DependencyPath | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddNodeWizard, setShowAddNodeWizard] = useState(false);
  const [showAddConnectionWizard, setShowAddConnectionWizard] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [nodePopupOpen, setNodePopupOpen] = useState(false);
  const [noDataPopupOpen, setNoDataPopupOpen] = useState(false);
  const [noDataNodeLabel, setNoDataNodeLabel] = useState('');
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null);
  const [customNodeIds, setCustomNodeIds] = useState<Set<string>>(new Set());
  const [allNodes, setAllNodes] = useState<{ id: string; name: string; type: string; layer: string }[]>([]);
  const lastClickRef = useRef<{ id: string; time: number } | null>(null);
  const singleClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  const highlightIds = useMemo(() => {
    const ids = new Set<string>();
    if (selectedNodeId) {
      ids.add(selectedNodeId);
      // Add immediate 1-hop neighbors synchronously so the blur is instant on click
      graph?.edges.forEach(e => {
        if (e.source === selectedNodeId) ids.add(e.target);
        if (e.target === selectedNodeId) ids.add(e.source);
      });
      // Expand to full upstream/downstream paths as they load
      paths?.upstream.forEach((p) => ids.add(p.node));
      paths?.downstream.forEach((p) => ids.add(p.node));
    }
    return ids;
  }, [selectedNodeId, graph, paths]);

  const handleNodeShortClick = useCallback((id: string, _isGroup: boolean) => {
    if (selectedNodeId === id) {
      setSelectedNodeId(null);
      setPaths(null);
    } else {
      setSelectedNodeId(id);
    }
  }, [selectedNodeId]);

  const handleNodeLongPress = useCallback((id: string, isGroup: boolean) => {
    if (!isGroup) {
      setSelectedNodeId(id);
      setSelectedGroupId(null);
      setNodePopupOpen(true);
    } else {
      setSelectedGroupId(id);
      setSelectedNodeId(null);
      setNodePopupOpen(false);
    }
  }, []);

  const handleNodeDoubleClick = useCallback((id: string, label: string) => {
    if (customNodeIds.has(id)) {
      setNoDataNodeLabel(label || id);
      setNoDataPopupOpen(true);
    } else {
      setSelectedNodeId(id);
      setSelectedGroupId(null);
      setNodePopupOpen(true);
    }
  }, [customNodeIds]);

  const closePopup = useCallback(() => setNodePopupOpen(false), []);
  const closeGroupPopup = useCallback(() => setSelectedGroupId(null), []);

  const loadGraph = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getDependencyGraph(Array.from(selectedViews), heatmap, selectedNodeId);
      setGraph(data);
      const { nodes: rfNodes, edges: rfEdges } = buildFlow(data, selectedNodeId, highlightIds, selectedViews, handleNodeLongPress, handleNodeShortClick, handleNodeDoubleClick);
      setNodes(rfNodes);
      setEdges(rfEdges);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load graph');
    } finally {
      setLoading(false);
    }
  }, [selectedViews, heatmap, selectedNodeId, highlightIds, setNodes, setEdges]);

  useEffect(() => {
    loadGraph();
  }, [selectedViews, heatmap]);

  useEffect(() => {
    if (graph) {
      const { nodes: rfNodes, edges: rfEdges } = buildFlow(graph, selectedNodeId, highlightIds, selectedViews, handleNodeLongPress, handleNodeShortClick, handleNodeDoubleClick);
      setNodes(rfNodes);
      setEdges(rfEdges);
    }
  }, [selectedNodeId, paths, graph, highlightIds, selectedViews, setNodes, setEdges]);

  // Ensure map zooms out completely to show all components
  useEffect(() => {
    if (rfInstance && graph && nodes.length > 0) {
      setTimeout(() => {
        window.requestAnimationFrame(() => {
          rfInstance.fitView({ padding: 0.2, maxZoom: 1 });
        });
      }, 50);
    }
  }, [selectedViews, heatmap, graph, rfInstance]);

  useEffect(() => {
    if (!selectedNodeId) { setPaths(null); return; }
    getDependencyPaths(selectedNodeId)
      .then(setPaths)
      .catch(() => setPaths(null));
  }, [selectedNodeId]);

  useEffect(() => {
    if (!graph) return;
    const q = searchTerm.trim().toLowerCase();
    let firstMatchId: string | null = null;

    setNodes((prev) =>
      prev.map((n) => {
        if (n.type === 'nodeGroup') return n;
        const gNode = graph.nodes.find((g) => g.id === n.id);
        const label = (gNode?.label ?? n.id).toLowerCase();
        const isSearchMatch = q.length >= 2 && label.includes(q);
        if (isSearchMatch && !firstMatchId) {
          firstMatchId = n.id;
        }
        return {
          ...n,
          data: { ...n.data, isSearchMatch, dimmed: q.length >= 2 && !isSearchMatch },
        };
      }),
    );

    if (q.length >= 2 && firstMatchId && rfInstance) {
      setNodes((currentNodes) => {
        const node = currentNodes.find((n) => n.id === firstMatchId);
        if (node) {
          rfInstance.setCenter(node.position.x + 110, node.position.y + 40, { zoom: 1.2, duration: 800 });
        }
        return currentNodes;
      });
    }
  }, [searchTerm, graph, setNodes, rfInstance]);



  // Maps node type → functional category suffix used in group node IDs
  const TYPE_CATEGORY_SUFFIX: Record<string, string> = {
    microservice:     'microservices',
    business_service: 'business_service',
    database:         'storage',
    cache:            'storage',
    server:           'compute',
    container:        'compute',
    load_balancer:    'network',
    gateway:          'network',
    web_server:       'network',
  };

  const KNOWN_PLATFORMS = ['on-prem-physical', 'on-prem-vmware', 'aws', 'gcp', 'azure'];

  const handleAddCustomNode = (
    nodeType: string,
    layer: string,
    nodeId: string,
    nodeLabel: string,
    connectFrom: string,
    connectTo: string,
    relationship: string,
  ) => {
    // Determine which group box this node belongs to
    const categorySuffix = TYPE_CATEGORY_SUFFIX[nodeType];

    // Priority rules for finding the parent group node:
    //   1. Microservices  → grp-all-microservices OR grp-app-* (first match)
    //   2. Business svc   → grp-layer-business_service
    //   3. Infra (storage/compute/network) → grp-plat-*-{category}
    let groupNode: Node | undefined;
    if (nodeType === 'microservice') {
      groupNode = nodes.find(
        (n) => n.type === 'nodeGroup' &&
          (n.id === 'grp-all-microservices' || n.id.startsWith('grp-app-'))
      );
    } else if (nodeType === 'business_service') {
      groupNode = nodes.find(
        (n) => n.type === 'nodeGroup' && n.id === 'grp-layer-business_service'
      );
    } else if (categorySuffix) {
      // Infra nodes: find a group whose ID ends with the category label
      groupNode = nodes.find(
        (n) => n.type === 'nodeGroup' && n.id.endsWith(`-${categorySuffix}`)
      );
    }

    const PAD = 20, HEADER = 34, NODE_W = 60, NODE_H = 60, GAP_X = 60, GAP_Y = 38;

    let position: { x: number; y: number };
    let parentId: string | undefined;

    if (groupNode) {
      const siblings = nodes.filter((n) => n.parentId === groupNode!.id);
      if (siblings.length === 0) {
        position = { x: PAD, y: HEADER + PAD };
      } else {
        // Find last row and either append to it or start a new row
        const maxY = Math.max(...siblings.map((n) => n.position.y));
        const onLastRow = siblings.filter((n) => Math.abs(n.position.y - maxY) < 5);
        if (onLastRow.length < 3) {
          const maxX = Math.max(...onLastRow.map((n) => n.position.x));
          position = { x: maxX + NODE_W + GAP_X, y: maxY };
        } else {
          position = { x: PAD, y: maxY + NODE_H + GAP_Y };
        }
      }
      parentId = groupNode.id;
    } else {
      const center = rfInstance
        ? rfInstance.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
        : { x: 200, y: 200 };
      position = { x: center.x + (Math.random() - 0.5) * 80, y: center.y + (Math.random() - 0.5) * 80 };
    }

    // For infrastructure nodes: prefer the platform embedded in the group node ID;
    // fall back to whichever platform is currently selected (so the node is placed
    // correctly after reload even when the infra groups aren't visible).
    const INFRA_NODE_TYPES = new Set(['database', 'cache', 'server', 'container', 'load_balancer', 'gateway', 'web_server']);
    const platform = groupNode
      ? KNOWN_PLATFORMS.find((p) => groupNode!.id.includes(p))
      : INFRA_NODE_TYPES.has(nodeType)
        ? KNOWN_PLATFORMS.find((p) => selectedViews.has(p as any))
        : undefined;

    const rfNode: Node = {
      id: nodeId,
      type: 'dependency',
      position,
      ...(parentId ? { parentId, extent: 'parent' as const } : {}),
      data: {
        label: nodeLabel || nodeId,
        type: nodeType,
        layer,
        health: 'unknown',
        heatmapValue: 0,
        heatmapMetric: heatmap,
        isSelected: false,
        isHighlighted: false,
        isSearchMatch: false,
        dimmed: false,
        isCustom: true,
        onLongPress: handleNodeLongPress,
        onClick: handleNodeShortClick,
        onDoubleClick: handleNodeDoubleClick,
      },
    };

    setNodes((prev) => [...prev, rfNode]);
    setCustomNodeIds((prev) => new Set([...prev, nodeId]));

    // Persist node to backend
    addCustomNode({ id: nodeId, name: nodeLabel || nodeId, type: nodeType, layer, ...(platform ? { platform } : {}) });

    // Persist connection to backend only — no visual edge on map (avoids cross-group arrows)
    if (connectFrom.trim() && connectTo.trim()) {
      addDependency(connectFrom.trim(), connectTo.trim(), relationship || 'calls').catch(() => {});
    }
    setShowAddNodeWizard(false);
  };

  const handleDeleteEdge = async (source: string, target: string) => {
    await deleteDependency(source, target);
    loadGraph();
    if (selectedNodeId) {
      getDependencyPaths(selectedNodeId).then(setPaths).catch(() => setPaths(null));
    }
  };

  const handleEditEdge = async (source: string, target: string) => {
    const relationship = prompt('New relationship type:', 'calls');
    if (!relationship) return;
    await fetch('/api/dependencies/edges', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source, target, relationship }),
    });
    loadGraph();
  };

  const selectedNode = graph?.nodes.find((n) => n.id === selectedNodeId) ?? null;
  const searchMatchCount =
    searchTerm.trim().length >= 2 ? nodes.filter((n) => n.data.isSearchMatch).length : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Dependency Mapping</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Interactive topology · click a node to inspect · double-click for metrics
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => { setShowAddConnectionWizard(true); listAllNodes().then(setAllNodes); }} className={btnSecondary}>
            Add Connection
          </button>
          <button
            onClick={() => setShowAddNodeWizard(true)}
            className={`${btnPrimary} text-xs py-1.5 px-3`}
          >
            Add Component
          </button>
        </div>
      </div>

      {/* View + Heatmap selectors */}
      <div className="flex flex-wrap gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap gap-1 items-center">
            {MAIN_VIEW_ITEMS.map((v) => (
              <button
                key={v.id}
                onClick={() => {
                  setSelectedViews((prev) => {
                    const next = new Set(prev);
                    if (next.has(v.id)) { if (next.size > 1) next.delete(v.id); }
                    else next.add(v.id);
                    return next;
                  });
                  setSelectedNodeId(null); setSearchTerm(''); setNodePopupOpen(false);
                }}
                className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${selectedViews.has(v.id)
                  ? 'bg-blue-600 border-blue-500 text-white'
                  : 'bg-slate-100 dark:bg-slate-800 border-slate-600 text-slate-700 dark:text-slate-300 hover:border-slate-500'
                  }`}
              >
                {v.label}
              </button>
            ))}
            {/* Platform button */}
            <button
              onClick={() => setPlatformExpanded((p) => !p)}
              className={`px-3 py-1.5 text-xs rounded-lg border transition-colors flex items-center gap-1 ${
                PLATFORM_VIEWS.some((p) => selectedViews.has(p.id))
                  ? 'bg-blue-600 border-blue-500 text-white'
                  : 'bg-slate-100 dark:bg-slate-800 border-slate-600 text-slate-700 dark:text-slate-300 hover:border-slate-500'
              }`}
            >
              Platform
              <span className="text-[10px] opacity-70">{platformExpanded ? '▴' : '▾'}</span>
            </button>
          </div>
          {platformExpanded && (
            <div className="flex flex-wrap gap-1 pl-1 pt-0.5">
              {PLATFORM_VIEWS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    setSelectedViews((prev) => {
                      const next = new Set(prev);
                      if (next.has(p.id)) { if (next.size > 1) next.delete(p.id); }
                      else next.add(p.id);
                      return next;
                    });
                    setSelectedNodeId(null); setSearchTerm(''); setNodePopupOpen(false);
                  }}
                  className={`px-2.5 py-1 text-[11px] rounded-md border transition-colors ${selectedViews.has(p.id)
                    ? 'bg-indigo-600 border-indigo-500 text-white'
                    : 'bg-slate-50 dark:bg-slate-900 border-slate-500 text-slate-600 dark:text-slate-400 hover:border-slate-400'
                    }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mr-1">Golden Signals</span>
          {GOLDEN_SIGNALS.map((gs) => {
            const active = heatmap === gs.id;
            const accentClasses: Record<string, { on: string; off: string }> = {
              blue:   { on: 'bg-blue-600/20 border-blue-500 text-blue-300',     off: 'border-blue-900/40 text-blue-400/60 hover:border-blue-600 hover:text-blue-300' },
              purple: { on: 'bg-purple-600/20 border-purple-500 text-purple-300', off: 'border-purple-900/40 text-purple-400/60 hover:border-purple-600 hover:text-purple-300' },
              red:    { on: 'bg-red-600/20 border-red-500 text-red-300',         off: 'border-red-900/40 text-red-400/60 hover:border-red-600 hover:text-red-300' },
              orange: { on: 'bg-orange-600/20 border-orange-500 text-orange-300', off: 'border-orange-900/40 text-orange-400/60 hover:border-orange-600 hover:text-orange-300' },
            };
            const cls = accentClasses[gs.accent] ?? accentClasses.blue;
            return (
              <button
                key={gs.id}
                onClick={() => setHeatmap(gs.id)}
                title={gs.desc}
                className={`group relative px-3 py-1.5 text-xs font-medium rounded-lg border transition-all ${active ? cls.on : `bg-slate-100 dark:bg-slate-800/60 ${cls.off}`}`}
              >
                {gs.label}
                {active && <span className="ml-1.5 inline-block w-1.5 h-1.5 rounded-full bg-current align-middle" />}
                <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 rounded-lg bg-slate-900 px-2 py-1.5 text-[10px] text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity z-50 text-center shadow-xl border border-slate-700">
                  {gs.desc}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Legend + search */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 text-xs items-center flex-wrap">
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-500" /> Healthy</span>
          <span className="flex items-center gap-1 ml-3"><span className="w-3 h-3 rounded bg-yellow-500" /> Warning</span>
          <span className="flex items-center gap-1 ml-3"><span className="w-3 h-3 rounded bg-red-500" /> Critical</span>
          <span className="flex items-center gap-1 ml-3"><span className="w-3 h-3 rounded border-2 border-amber-400" /> Search match</span>
          <span className="text-slate-400 ml-3 hidden sm:inline">· Double-click a node for metrics</span>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Search nodes…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-48 px-3 py-1.5 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none placeholder:text-slate-400 dark:text-slate-200"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 px-1"
            >
              ✕
            </button>
          )}
          {searchTerm.trim().length >= 2 && (
            <span className="text-xs text-amber-500 font-medium">
              {searchMatchCount} match{searchMatchCount !== 1 ? 'es' : ''}
            </span>
          )}
        </div>
      </div>

      {/* Graph + sidebar */}
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
        <div className="xl:col-span-3 h-[720px] bg-slate-100 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden relative">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-50 dark:bg-slate-900/80 z-10">
              <span className="text-slate-500 dark:text-slate-400">Loading graph…</span>
            </div>
          )}
          {error && (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-50 dark:bg-slate-900/80 z-10">
              <span className="text-red-600 dark:text-red-400">{error}</span>
            </div>
          )}
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onPaneClick={() => {
              if (singleClickTimerRef.current) clearTimeout(singleClickTimerRef.current);
              lastClickRef.current = null;
              setSelectedNodeId(null);
            }}
            onNodeClick={(_event, node) => {
              if (node.type !== 'dependency') return;
              // Cancel any pending single-click from a previous click on this node
              if (singleClickTimerRef.current) clearTimeout(singleClickTimerRef.current);

              const now = Date.now();
              const last = lastClickRef.current;

              if (last && last.id === node.id && now - last.time < 300) {
                // Second click on same node within 300 ms → treat as double-click.
                // Cancelling the single-click timer (above) means setSelectedNodeId
                // never fires between the two clicks, so ReactFlow's node tree is
                // stable when the second click arrives.
                lastClickRef.current = null;
                handleNodeDoubleClick(node.id, node.data?.label ?? node.id);
              } else {
                lastClickRef.current = { id: node.id, time: now };
                // Delay the single-click action so it can be cancelled if a second
                // click arrives within the double-click window.
                const clickedId = node.id;
                singleClickTimerRef.current = setTimeout(() => {
                  handleNodeShortClick(clickedId, false);
                }, 300);
              }
            }}
            zoomOnDoubleClick={false}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
            minZoom={0.15}
            maxZoom={2.5}
            onInit={setRfInstance}
            attributionPosition="bottom-left"
          >
            <Background color="#334155" gap={24} />
            <Controls showInteractive={true} showFitView={true} showZoom={true} />
            <MiniMap
              nodeColor={(n) => {
                const d = n.data as { heatmapValue: number; heatmapMetric: HeatmapMetric };
                return heatmapColor(d.heatmapValue, d.heatmapMetric);
              }}
              maskColor="rgb(15 23 42 / 0.8)"
              style={{ bottom: 40 }}
            />
          </ReactFlow>
        </div>

        <div className="space-y-4">
          <div className="p-4 bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-2">Graph Stats</h3>
            <div className="text-xs text-slate-500 dark:text-slate-400 space-y-1">
              <p>Nodes: <span className="text-slate-900 dark:text-white">{graph?.node_count ?? 0}</span></p>
              <p>Edges: <span className="text-slate-900 dark:text-white">{graph?.edge_count ?? 0}</span></p>
              <p>View: <span className="text-slate-900 dark:text-white">{Array.from(selectedViews).map(layerLabel).join(', ')}</span></p>
              <p>Signal: <span className="text-slate-900 dark:text-white capitalize">{GOLDEN_SIGNALS.find(g => g.id === heatmap)?.label ?? heatmap}</span></p>
            </div>
            <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-3 leading-relaxed">
              Scroll to zoom · drag to pan · click a node to inspect
            </p>
          </div>

          {selectedNode && (
            <div className="p-4 bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{selectedNode.label}</h3>
                <span className={`text-[10px] px-2 py-0.5 rounded border ${healthBadgeClass(selectedNode.health)}`}>
                  {selectedNode.health}
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                {selectedNode.type} · {layerLabel(selectedNode.layer)}
              </p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                {Object.entries(selectedNode.metrics).map(([k, v]) => (
                  <div key={k} className="bg-slate-100 dark:bg-slate-900/50 rounded px-2 py-1">
                    <span className="text-slate-500">{k}: </span>
                    <span className="text-slate-900 dark:text-white font-mono">
                      {typeof v === 'number' ? v.toFixed(1) : v}
                    </span>
                  </div>
                ))}
              </div>
              <button
                onClick={() => setNodePopupOpen(true)}
                className="mt-3 w-full text-xs py-1.5 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/50 rounded-lg text-blue-700 dark:text-blue-300 transition-colors"
              >
                View Metrics
              </button>
            </div>
          )}

          {selectedNodeId && (
            <div className="p-4 bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-2">Connections</h3>
              {!paths ? (
                <p className="text-xs text-slate-400 animate-pulse">Loading connections…</p>
              ) : (
                <div className="space-y-3 text-xs">
                  {/* Upstream */}
                  <div>
                    <div className="flex items-center gap-1 mb-1.5">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-violet-500">↑ Upstream</span>
                      <span className="text-[10px] bg-violet-100 dark:bg-violet-900/40 text-violet-600 dark:text-violet-300 px-1.5 rounded-full font-medium">{paths.upstream.length}</span>
                    </div>
                    {paths.upstream.length === 0 ? (
                      <p className="text-[11px] text-slate-400 dark:text-slate-600 italic">No upstream connections</p>
                    ) : (
                      paths.upstream.map((p) => (
                        <div key={p.node} className="flex items-center gap-1 mb-1 group">
                          <button
                            onClick={() => setSelectedNodeId(p.node)}
                            className="flex-1 text-left px-2 py-1.5 rounded-lg hover:bg-violet-50 dark:hover:bg-violet-900/20 text-violet-700 dark:text-purple-300 transition-colors"
                          >
                            <div className="font-medium truncate">{p.node}</div>
                            <div className="text-[10px] text-slate-400 mt-0.5">via {p.relationship}</div>
                          </button>
                          <button title="Edit" onClick={() => handleEditEdge(p.node, selectedNodeId!)}
                            className="opacity-0 group-hover:opacity-100 px-1.5 py-1 text-slate-400 hover:text-slate-700 dark:hover:text-white transition-all">✎</button>
                          <button title="Delete" onClick={() => handleDeleteEdge(p.node, selectedNodeId!)}
                            className="opacity-0 group-hover:opacity-100 px-1.5 py-1 text-red-400 hover:text-red-600 transition-all">×</button>
                        </div>
                      ))
                    )}
                  </div>

                  {/* Divider */}
                  <div className="border-t border-slate-100 dark:border-slate-700/60" />

                  {/* Downstream */}
                  <div>
                    <div className="flex items-center gap-1 mb-1.5">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-blue-500">↓ Downstream</span>
                      <span className="text-[10px] bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300 px-1.5 rounded-full font-medium">{paths.downstream.length}</span>
                    </div>
                    {paths.downstream.length === 0 ? (
                      <p className="text-[11px] text-slate-400 dark:text-slate-600 italic">No downstream connections</p>
                    ) : (
                      paths.downstream.map((p) => (
                        <div key={p.node} className="flex items-center gap-1 mb-1 group">
                          <button
                            onClick={() => setSelectedNodeId(p.node)}
                            className="flex-1 text-left px-2 py-1.5 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 text-blue-700 dark:text-blue-300 transition-colors"
                          >
                            <div className="font-medium truncate">{p.node}</div>
                            <div className="text-[10px] text-slate-400 mt-0.5">via {p.relationship}</div>
                          </button>
                          <button title="Edit" onClick={() => handleEditEdge(selectedNodeId!, p.node)}
                            className="opacity-0 group-hover:opacity-100 px-1.5 py-1 text-slate-400 hover:text-slate-700 dark:hover:text-white transition-all">✎</button>
                          <button title="Delete" onClick={() => handleDeleteEdge(selectedNodeId!, p.node)}
                            className="opacity-0 group-hover:opacity-100 px-1.5 py-1 text-red-400 hover:text-red-600 transition-all">×</button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Node metrics panel (long-press) */}
      {nodePopupOpen && selectedNode && (
        <NodeMetricsPanel
          node={selectedNode}
          onClose={closePopup}
        />
      )}

      {selectedGroupId && graph && (
        <GroupDetailsPopup
          groupId={selectedGroupId}
          graph={graph}
          nodes={nodes}
          heatmapMetric={heatmap}
          onClose={closeGroupPopup}
          onNodeSelect={(id) => {
             setSelectedGroupId(null);
             setSelectedNodeId(id);
             setNodePopupOpen(true);
          }}
        />
      )}

      {/* Add Component Wizard */}
      {showAddNodeWizard && (
        <AddNodeWizard
          existingNodeIds={[
            ...(graph?.nodes.map((n) => n.id) ?? []),
            ...Array.from(customNodeIds),
          ]}
          onAdd={handleAddCustomNode}
          onClose={() => setShowAddNodeWizard(false)}
        />
      )}

      {/* Add Connection Wizard */}
      {showAddConnectionWizard && (
        <AddConnectionWizard
          existingNodes={allNodes.map(n => ({ id: n.id, label: n.name || n.id, type: n.type, layer: n.layer }))}
          onAdd={(source, target, relationship) => {
            // Only persist to backend — no visual edge drawn on the canvas.
            // The connection will appear in the "Connections" panel when either
            // endpoint node is single-clicked.
            addDependency(source, target, relationship || 'calls')
              .then(() => {
                // Refresh paths for the currently selected node so new connection is reflected immediately
                if (selectedNodeId) {
                  getDependencyPaths(selectedNodeId).then(setPaths).catch(() => setPaths(null));
                }
              })
              .catch(() => {});
            setShowAddConnectionWizard(false);
          }}
          onClose={() => setShowAddConnectionWizard(false)}
        />
      )}

      {/* No data available modal for custom nodes */}
      {noDataPopupOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setNoDataPopupOpen(false)} />
          <div className="relative z-10 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl p-8 max-w-sm w-full text-center">
            <div className="w-14 h-14 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 2.625c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
              </svg>
            </div>
            <h3 className="text-base font-semibold text-slate-900 dark:text-white mb-1">{noDataNodeLabel}</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-5">
              No telemetry data available for this node.<br />It was added manually and has no associated metrics, logs, or traces.
            </p>
            <button
              onClick={() => setNoDataPopupOpen(false)}
              className="px-5 py-2 rounded-lg text-sm font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Add Node Wizard ──────────────────────────────────────────────────────────

const NODE_TYPES = [
  {
    id: 'microservice',
    layer: 'microservice',
    label: 'Microservice',
    desc: 'API service or application component',
    color: 'blue',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
      </svg>
    ),
  },
  {
    id: 'database',
    layer: 'infrastructure',
    label: 'Storage',
    desc: 'Database, cache, or object storage',
    color: 'purple',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 2.625c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
      </svg>
    ),
  },
  {
    id: 'server',
    layer: 'infrastructure',
    label: 'Compute',
    desc: 'Virtual machine, container, or bare metal',
    color: 'green',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 14.25h13.5m-13.5 0a3 3 0 01-3-3m3 3a3 3 0 100 6h13.5a3 3 0 100-6m-16.5-3a3 3 0 013-3h13.5a3 3 0 013 3m-19.5 0a4.5 4.5 0 01.9-2.7L5.737 5.1a3.375 3.375 0 012.7-1.35h7.126c1.062 0 2.062.5 2.7 1.35l2.587 3.45a4.5 4.5 0 01.9 2.7m0 0a3 3 0 01-3 3m0 3h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008zm-3 6h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008z" />
      </svg>
    ),
  },
  {
    id: 'load_balancer',
    layer: 'infrastructure',
    label: 'Network',
    desc: 'Load balancer, gateway, or router',
    color: 'orange',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
      </svg>
    ),
  },
] as const;

const COLOR_CLASSES: Record<string, { card: string; icon: string; badge: string }> = {
  blue:   { card: 'border-blue-500 bg-blue-50 dark:bg-blue-950/30',     icon: 'text-blue-600 dark:text-blue-400',   badge: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300' },
  purple: { card: 'border-purple-500 bg-purple-50 dark:bg-purple-950/30', icon: 'text-purple-600 dark:text-purple-400', badge: 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300' },
  green:  { card: 'border-green-500 bg-green-50 dark:bg-green-950/30',   icon: 'text-green-600 dark:text-green-400',  badge: 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300' },
  orange: { card: 'border-orange-500 bg-orange-50 dark:bg-orange-950/30', icon: 'text-orange-600 dark:text-orange-400', badge: 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300' },
};
const COLOR_IDLE = 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 hover:border-slate-400 dark:hover:border-slate-500';

function AddNodeWizard({
  existingNodeIds,
  onAdd,
  onClose,
}: {
  existingNodeIds: string[];
  onAdd: (nodeType: string, layer: string, nodeId: string, nodeLabel: string, connectFrom: string, connectTo: string, relationship: string) => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [selectedType, setSelectedType] = useState<typeof NODE_TYPES[number] | null>(null);
  const [nodeId, setNodeId] = useState('');
  const [nodeLabel, setNodeLabel] = useState('');
  const [idError, setIdError] = useState('');

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleNext = () => {
    if (!selectedType) return;
    setStep(2);
  };

  const handleAdd = () => {
    const id = nodeId.trim();
    if (!id) { setIdError('Node ID is required'); return; }
    if (existingNodeIds.includes(id)) { setIdError('A node with this ID already exists'); return; }
    setIdError('');
    onAdd(selectedType!.id, selectedType!.layer, id, nodeLabel.trim() || id, '', '', '');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Add Node to Map</h2>
            <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">Step {step} of 2</p>
          </div>
          <button onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Step 1 — choose type */}
        {step === 1 && (
          <div className="p-6 space-y-4">
            <p className="text-xs text-slate-600 dark:text-slate-400">What type of node do you want to add?</p>
            <div className="grid grid-cols-2 gap-3">
              {NODE_TYPES.map((t) => {
                const active = selectedType?.id === t.id;
                const cls = COLOR_CLASSES[t.color];
                return (
                  <button
                    key={t.id}
                    onClick={() => setSelectedType(t)}
                    className={`p-4 rounded-xl border-2 text-left transition-all ${active ? cls.card : COLOR_IDLE}`}
                  >
                    <div className={`mb-2 ${active ? cls.icon : 'text-slate-400 dark:text-slate-500'}`}>
                      {t.icon}
                    </div>
                    <div className="font-semibold text-sm text-slate-900 dark:text-white">{t.label}</div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">{t.desc}</div>
                    {active && (
                      <span className={`inline-block mt-2 text-[10px] px-2 py-0.5 rounded-full font-medium ${cls.badge}`}>
                        Selected
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <div className="flex justify-end pt-2">
              <button
                onClick={handleNext}
                disabled={!selectedType}
                className="px-5 py-2 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-40 transition-colors"
              >
                Next →
              </button>
            </div>
          </div>
        )}

        {/* Step 2 — fill details */}
        {step === 2 && selectedType && (
          <div className="p-6 space-y-4">
            <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium ${COLOR_CLASSES[selectedType.color].badge}`}>
              <span className={COLOR_CLASSES[selectedType.color].icon}>{selectedType.icon}</span>
              {selectedType.label}
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider mb-1">
                  Node ID <span className="text-red-500">*</span>
                </label>
                <input
                  autoFocus
                  value={nodeId}
                  onChange={(e) => { setNodeId(e.target.value); setIdError(''); }}
                  placeholder={`e.g. ${selectedType.label.toLowerCase()}-01`}
                  className={`w-full px-3 py-2 text-sm rounded-lg border bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder:text-slate-400 outline-none focus:ring-2 ${idError ? 'border-red-500 focus:ring-red-500/30' : 'border-slate-300 dark:border-slate-600 focus:ring-blue-500/30 focus:border-blue-500'}`}
                />
                {idError && <p className="text-[10px] text-red-500 mt-1">{idError}</p>}
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider mb-1">
                  Display Label <span className="text-slate-400 font-normal">(optional)</span>
                </label>
                <input
                  value={nodeLabel}
                  onChange={(e) => setNodeLabel(e.target.value)}
                  placeholder="Defaults to Node ID"
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                />
              </div>

            </div>

            <div className="flex items-center justify-between pt-2">
              <button onClick={() => setStep(1)} className="px-4 py-2 rounded-lg text-sm text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                ← Back
              </button>
              <button
                onClick={handleAdd}
                className="px-5 py-2 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-500 transition-colors"
              >
                Add to Map
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Add Connection Wizard ─────────────────────────────────────────────────────

type ConnCategory = 'microservices' | 'storage' | 'compute' | 'network';

const CONN_CATEGORIES: { id: ConnCategory; label: string; icon: string }[] = [
  { id: 'microservices', label: 'Microservices', icon: '⚙️' },
  { id: 'storage',       label: 'Storage',       icon: '🛢️' },
  { id: 'compute',       label: 'Compute',        icon: '🖥️' },
  { id: 'network',       label: 'Network',        icon: '⚖️' },
];

function nodeCategory(type: string, layer: string): ConnCategory | null {
  // Service layers (type or layer match)
  if (['microservice', 'application', 'business_service'].includes(layer) ||
      ['microservice', 'business_service'].includes(type)) return 'microservices';
  // Infrastructure — use type as the discriminator since layer is often "server"
  if (['database', 'cache'].includes(type)) return 'storage';
  if (['server', 'container', 'kubernetes_cluster'].includes(type)) return 'compute';
  if (['load_balancer', 'gateway', 'web_server'].includes(type)) return 'network';
  return null;
}

function NodePicker({
  label,
  nodes,
  value,
  onChange,
  error,
}: {
  label: string;
  nodes: { id: string; label: string; type: string; layer: string }[];
  value: string;
  onChange: (id: string) => void;
  error?: string;
}) {
  const [category, setCategory] = useState<ConnCategory | null>(null);

  const filtered = category
    ? nodes.filter((n) => nodeCategory(n.type, n.layer) === category)
    : [];

  const selectedNode = nodes.find((n) => n.id === value);

  return (
    <div className="space-y-2">
      <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
        {label} <span className="text-red-500">*</span>
      </label>

      {/* Category pills */}
      <div className="flex gap-1.5 flex-wrap">
        {CONN_CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            type="button"
            onClick={() => { setCategory(cat.id); onChange(''); }}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors ${
              category === cat.id
                ? 'bg-blue-600 border-blue-500 text-white'
                : 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:border-blue-400 hover:text-blue-600 dark:hover:text-blue-400'
            }`}
          >
            <span>{cat.icon}</span>
            {cat.label}
          </button>
        ))}
      </div>

      {/* Node dropdown — shown once a category is chosen */}
      {category && (
        filtered.length > 0 ? (
          <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className={`w-full px-3 py-2 text-sm rounded-lg border bg-white dark:bg-slate-800 text-slate-900 dark:text-white outline-none focus:ring-2 ${
              error
                ? 'border-red-500 focus:ring-red-500/30'
                : 'border-slate-300 dark:border-slate-600 focus:ring-blue-500/30 focus:border-blue-500'
            }`}
          >
            <option value="">— select a component —</option>
            {filtered.map((n) => (
              <option key={n.id} value={n.id}>{n.label} ({n.id})</option>
            ))}
          </select>
        ) : (
          <p className="text-[11px] text-slate-400 dark:text-slate-500 italic px-1">
            No {CONN_CATEGORIES.find(c => c.id === category)?.label.toLowerCase()} components found.
          </p>
        )
      )}

      {/* Show selected node badge */}
      {selectedNode && (
        <div className="flex items-center gap-1.5 text-[11px] text-blue-600 dark:text-blue-400">
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414L8.414 15 3.293 9.879a1 1 0 011.414-1.414L8.414 12.172l6.879-6.879a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
          {selectedNode.label}
        </div>
      )}

      {error && <p className="text-[10px] text-red-500">{error}</p>}
    </div>
  );
}

function AddConnectionWizard({
  existingNodes,
  onAdd,
  onClose,
}: {
  existingNodes: { id: string; label: string; type: string; layer: string }[];
  onAdd: (source: string, target: string, relationship: string) => void;
  onClose: () => void;
}) {
  const [source, setSource] = useState('');
  const [target, setTarget] = useState('');
  const [relationship, setRelationship] = useState('calls');
  const [errors, setErrors] = useState<{ source?: string; target?: string }>({});

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleAdd = () => {
    const errs: { source?: string; target?: string } = {};
    if (!source) errs.source = 'Select a source component';
    if (!target) errs.target = 'Select a target component';
    if (source && target && source === target) errs.target = 'Source and target must be different';
    if (Object.keys(errs).length) { setErrors(errs); return; }
    onAdd(source, target, relationship.trim() || 'calls');
  };

  const sourceNode = existingNodes.find((n) => n.id === source);
  const targetNode = existingNodes.find((n) => n.id === target);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Add Connection</h2>
            <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">Saved to backend · visible in Connections panel on single-click</p>
          </div>
          <button onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Arrow preview */}
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
            <div className="flex-1 text-center">
              <div className="text-[10px] uppercase tracking-wider text-slate-400 mb-1">From</div>
              <div className="text-xs font-semibold text-slate-700 dark:text-slate-200 truncate">
                {sourceNode?.label || '—'}
              </div>
            </div>
            <svg className="w-5 h-5 text-slate-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
            </svg>
            <div className="flex-1 text-center">
              <div className="text-[10px] uppercase tracking-wider text-slate-400 mb-1">To</div>
              <div className="text-xs font-semibold text-slate-700 dark:text-slate-200 truncate">
                {targetNode?.label || '—'}
              </div>
            </div>
          </div>

          <NodePicker
            label="From"
            nodes={existingNodes}
            value={source}
            onChange={(id) => { setSource(id); setErrors((p) => ({ ...p, source: undefined })); }}
            error={errors.source}
          />

          <NodePicker
            label="To"
            nodes={existingNodes}
            value={target}
            onChange={(id) => { setTarget(id); setErrors((p) => ({ ...p, target: undefined })); }}
            error={errors.target}
          />

          <div>
            <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider mb-1">
              Relationship <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <input
              value={relationship}
              onChange={(e) => setRelationship(e.target.value)}
              placeholder="e.g. calls, depends-on, routes-to"
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
            />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
              Cancel
            </button>
            <button
              onClick={handleAdd}
              className="px-5 py-2 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-500 transition-colors"
            >
              Add Connection
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
