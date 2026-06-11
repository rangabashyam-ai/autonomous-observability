import { useCallback, useEffect, useMemo, useState } from 'react';
import * as dagre from 'dagre';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  MarkerType,
  type Node,
  type Edge,
  type ReactFlowInstance,
} from 'reactflow';
import 'reactflow/dist/style.css';

import DependencyNode from './DependencyNode';
import { ReportChat } from './ReportChat';
import {
  getDependencyGraph,
  getDependencyPaths,
  addDependency,
  deleteDependency,
  uploadCsvDependencies,
  uploadJsonDependency,
} from '../api/client';
import type { DependencyGraph, DependencyPath, GraphNode, HeatmapMetric, ViewType } from '../types/api';
import { healthBadgeClass, layerLabel } from '../utils/colors';
import { inputClass, btnSecondary, btnPrimary } from './ui';

const nodeTypes = { dependency: DependencyNode };

const VIEWS: { id: ViewType; label: string }[] = [
  { id: 'data_center', label: 'Data Center' },
  { id: 'rack', label: 'Rack' },
  { id: 'server', label: 'Server' },
  { id: 'business_service', label: 'Business Service' },
  { id: 'application', label: 'Application' },
  { id: 'microservice', label: 'Microservice' },
  { id: 'infrastructure', label: 'Infrastructure' },
];

const HEATMAPS: { id: HeatmapMetric; label: string }[] = [
  { id: 'cpu', label: 'CPU' },
  { id: 'memory', label: 'Memory' },
  { id: 'storage', label: 'Storage' },
  { id: 'io', label: 'I/O' },
  { id: 'network', label: 'Network' },
  { id: 'latency', label: 'Latency' },
  { id: 'error_rate', label: 'Error Rate' },
  { id: 'incident_count', label: 'Incidents' },
  { id: 'risk_score', label: 'Risk Score' },
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

  dagreGraph.setGraph({ rankdir: direction, nodesep: 60, ranksep: 200 });

  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: 220, height: 80 });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  const MAX_PER_COL = 6;
  const X_OFFSET = 260;
  const Y_GAP = 120;

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
        x: finalPositions[node.id].x - 220 / 2,
        y: finalPositions[node.id].y - 80 / 2,
      },
      width: 220,
      height: 80,
    };
  });
}

function buildEdges(graph: DependencyGraph, highlightIds: Set<string>): Edge[] {
  return graph.edges.map((e, i) => ({
    id: `e-${e.source}-${e.target}-${i}`,
    source: e.source,
    target: e.target,
    label: e.relationship,
    labelStyle: { fill: '#94a3b8', fontSize: 10 },
    animated: highlightIds.has(e.source) || highlightIds.has(e.target),
    style: {
      stroke: highlightIds.has(e.source) || highlightIds.has(e.target) ? '#a855f7' : '#475569',
      strokeWidth: highlightIds.has(e.source) || highlightIds.has(e.target) ? 2.5 : 1.5,
    },
    markerEnd: { type: MarkerType.ArrowClosed, color: '#64748b' },
  }));
}

function buildNodeContext(node: GraphNode, paths: DependencyPath | null, heatmapMetric: string): string {
  const metricStr = Object.entries(node.metrics)
    .map(([k, v]) => `${k}=${typeof v === 'number' ? v.toFixed(1) : v}`)
    .join(', ');

  const lines = [
    `NODE: ${node.label}`,
    `TYPE: ${node.type}`,
    `LAYER: ${node.layer}`,
    `HEALTH: ${node.health}`,
    `HEATMAP_METRIC: ${heatmapMetric} = ${node.heatmap_value.toFixed(1)}`,
    `METRICS: ${metricStr}`,
  ];

  if (paths) {
    lines.push(
      paths.upstream.length > 0
        ? `UPSTREAM_DEPS: ${paths.upstream.map((p) => `${p.node} (${p.relationship})`).join(', ')}`
        : 'UPSTREAM_DEPS: none',
    );
    lines.push(
      paths.downstream.length > 0
        ? `DOWNSTREAM_DEPS: ${paths.downstream.map((p) => `${p.node} (${p.relationship})`).join(', ')}`
        : 'DOWNSTREAM_DEPS: none',
    );
  }

  return lines.join('\n');
}

// ── Node Chat Popup ──────────────────────────────────────────────────────────

interface NodeChatPopupProps {
  node: GraphNode;
  paths: DependencyPath | null;
  pathsLoading: boolean;
  heatmapMetric: string;
  onClose: () => void;
}

function NodeChatPopup({ node, paths, pathsLoading, heatmapMetric, onClose }: NodeChatPopupProps) {
  const context = useMemo(
    () => buildNodeContext(node, paths, heatmapMetric),
    [node, paths, heatmapMetric],
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[88vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-700 shrink-0">
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">{node.label}</h2>
              <span className={`text-[10px] px-2 py-0.5 rounded border ${healthBadgeClass(node.health)}`}>
                {node.health}
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {node.type} &middot; {layerLabel(node.layer)}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 dark:hover:text-white text-2xl leading-none ml-4 shrink-0"
          >
            &times;
          </button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-5">

          {/* Metrics grid */}
          <section>
            <p className="text-[10px] font-semibold tracking-widest text-slate-500 dark:text-slate-400 uppercase mb-2">
              Metrics
            </p>
            <div className="grid grid-cols-3 gap-2 text-xs">
              {Object.entries(node.metrics).map(([k, v]) => (
                <div key={k} className="bg-slate-100 dark:bg-slate-800 rounded-lg px-2.5 py-2">
                  <div className="text-slate-500 dark:text-slate-400 capitalize">{k.replace(/_/g, ' ')}</div>
                  <div className="text-slate-900 dark:text-white font-mono font-semibold mt-0.5">
                    {typeof v === 'number' ? v.toFixed(1) : v}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Dependency paths */}
          <section>
            <p className="text-[10px] font-semibold tracking-widest text-slate-500 dark:text-slate-400 uppercase mb-2">
              Dependency Paths
            </p>
            {pathsLoading ? (
              <p className="text-xs text-slate-400 dark:text-slate-500">Loading paths…</p>
            ) : paths ? (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[10px] text-slate-500 mb-1.5">↑ Upstream ({paths.upstream.length})</p>
                  {paths.upstream.length === 0 ? (
                    <p className="text-xs text-slate-400 dark:text-slate-600">None</p>
                  ) : (
                    <div className="space-y-1">
                      {paths.upstream.map((p) => (
                        <div
                          key={p.node}
                          className="text-xs px-2.5 py-1.5 bg-violet-50 dark:bg-purple-900/20 border border-violet-200 dark:border-purple-800/40 rounded-lg"
                        >
                          <span className="text-violet-700 dark:text-purple-300 font-medium">{p.node}</span>
                          <span className="text-slate-400 ml-1">({p.relationship})</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <p className="text-[10px] text-slate-500 mb-1.5">↓ Downstream ({paths.downstream.length})</p>
                  {paths.downstream.length === 0 ? (
                    <p className="text-xs text-slate-400 dark:text-slate-600">None</p>
                  ) : (
                    <div className="space-y-1">
                      {paths.downstream.map((p) => (
                        <div
                          key={p.node}
                          className="text-xs px-2.5 py-1.5 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/40 rounded-lg"
                        >
                          <span className="text-blue-700 dark:text-blue-300 font-medium">{p.node}</span>
                          <span className="text-slate-400 ml-1">({p.relationship})</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-400 dark:text-slate-500">No path data available.</p>
            )}
          </section>

          {/* Chat */}
          <ReportChat
            key={node.id}
            reportContext={context}
            reportType="dependency_node"
            subtitle="Scoped to Maps"
            entityName={node.label}
            suggestedQuestions={['What are the upstream dependencies?', 'Is this node healthy?', 'Show metrics for this node']}
          />
        </div>
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export default function DependencyMap() {
  const [view, setView] = useState<ViewType>('business_service');
  const [heatmap, setHeatmap] = useState<HeatmapMetric>('cpu');
  const [graph, setGraph] = useState<DependencyGraph | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [paths, setPaths] = useState<DependencyPath | null>(null);
  const [pathsLoading, setPathsLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newDep, setNewDep] = useState({ source: '', target: '', relationship: 'calls' });
  const [searchTerm, setSearchTerm] = useState('');
  const [nodePopupOpen, setNodePopupOpen] = useState(false);
  const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null);

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  const highlightIds = useMemo(() => {
    const ids = new Set<string>();
    if (selectedNodeId) ids.add(selectedNodeId);
    paths?.upstream.forEach((p) => ids.add(p.node));
    paths?.downstream.forEach((p) => ids.add(p.node));
    return ids;
  }, [selectedNodeId, paths]);

  const loadGraph = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getDependencyGraph(view, heatmap, selectedNodeId);
      setGraph(data);
      const rawNodes = buildNodes(data, selectedNodeId);
      const rawEdges = buildEdges(data, highlightIds);
      setNodes(getLayoutedNodes(rawNodes, rawEdges));
      setEdges(rawEdges);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load graph');
    } finally {
      setLoading(false);
    }
  }, [view, heatmap, selectedNodeId, highlightIds, setNodes, setEdges]);

  useEffect(() => {
    loadGraph();
  }, [view, heatmap]);

  useEffect(() => {
    if (graph) {
      const rawNodes = buildNodes(graph, selectedNodeId);
      const rawEdges = buildEdges(graph, highlightIds);
      setNodes(getLayoutedNodes(rawNodes, rawEdges));
      setEdges(rawEdges);
    }
  }, [selectedNodeId, paths, graph, highlightIds, setNodes, setEdges]);

  // Ensure map zooms out completely to show all components
  useEffect(() => {
    if (rfInstance && graph && nodes.length > 0) {
      setTimeout(() => {
        window.requestAnimationFrame(() => {
          rfInstance.fitView({ padding: 0.2 });
        });
      }, 50);
    }
  }, [view, heatmap, graph, rfInstance]);

  useEffect(() => {
    if (!selectedNodeId) {
      setPaths(null);
      return;
    }
    setPathsLoading(true);
    getDependencyPaths(selectedNodeId)
      .then(setPaths)
      .catch(() => setPaths(null))
      .finally(() => setPathsLoading(false));
  }, [selectedNodeId]);

  useEffect(() => {
    if (!graph) return;
    const q = searchTerm.trim().toLowerCase();
    let firstMatchId: string | null = null;

    setNodes((prev) =>
      prev.map((n) => {
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

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNodeId(node.id);
    setNodePopupOpen(true);
    if (rfInstance) {
      rfInstance.setCenter(node.position.x + 110, node.position.y + 40, { zoom: 1.2, duration: 800 });
    }
  }, [rfInstance]);

  const closePopup = useCallback(() => setNodePopupOpen(false), []);

  const handleAddDependency = async () => {
    if (!newDep.source || !newDep.target) return;
    await addDependency(newDep.source, newDep.target, newDep.relationship);
    setNewDep({ source: '', target: '', relationship: 'calls' });
    setShowAddForm(false);
    setSelectedNodeId(null);
    loadGraph();
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

  const handleCsvUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await uploadCsvDependencies(file);
    loadGraph();
  };

  const handleJsonUpload = async () => {
    const input = prompt('Paste JSON: {"source":"...","target":"...","relationship":"calls"}');
    if (!input) return;
    try {
      const parsed = JSON.parse(input);
      await uploadJsonDependency(parsed.source, parsed.target, parsed.relationship || 'calls');
      loadGraph();
    } catch {
      alert('Invalid JSON');
    }
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
            Interactive topology · click any node to inspect and chat with the agent
          </p>
        </div>
        <div className="flex gap-2">
          <label className={`${btnSecondary} cursor-pointer`}>
            Upload CSV
            <input type="file" accept=".csv" className="hidden" onChange={handleCsvUpload} />
          </label>
          <button onClick={handleJsonUpload} className={btnSecondary}>
            Upload JSON
          </button>
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className={`${btnPrimary} text-xs py-1.5 px-3`}
          >
            Add Dependency
          </button>
        </div>
      </div>

      {showAddForm && (
        <div className="flex flex-wrap gap-2 p-4 bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl">
          <input
            placeholder="Source"
            value={newDep.source}
            onChange={(e) => setNewDep({ ...newDep, source: e.target.value })}
            className={`px-3 py-1.5 text-sm ${inputClass}`}
          />
          <input
            placeholder="Target"
            value={newDep.target}
            onChange={(e) => setNewDep({ ...newDep, target: e.target.value })}
            className={`px-3 py-1.5 text-sm ${inputClass}`}
          />
          <input
            placeholder="Relationship"
            value={newDep.relationship}
            onChange={(e) => setNewDep({ ...newDep, relationship: e.target.value })}
            className={`px-3 py-1.5 text-sm ${inputClass}`}
          />
          <button onClick={handleAddDependency} className="px-4 py-1.5 text-sm bg-green-600 rounded-lg text-white">
            Save
          </button>
        </div>
      )}

      {/* View + Heatmap selectors */}
      <div className="flex flex-wrap gap-4">
        <div className="flex flex-wrap gap-1">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              onClick={() => { setView(v.id); setSelectedNodeId(null); setSearchTerm(''); setNodePopupOpen(false); }}
              className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${view === v.id
                ? 'bg-blue-600 border-blue-500 text-white'
                : 'bg-slate-100 dark:bg-slate-800 border-slate-600 text-slate-700 dark:text-slate-300 hover:border-slate-500'
                }`}
            >
              {v.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1 items-center">
          <span className="text-xs text-slate-500 mr-1">Heatmap:</span>
          {HEATMAPS.map((h) => (
            <button
              key={h.id}
              onClick={() => setHeatmap(h.id)}
              className={`px-2 py-1 text-[10px] rounded border transition-colors ${heatmap === h.id
                ? 'bg-emerald-600/30 border-emerald-500 text-emerald-300'
                : 'bg-slate-100 dark:bg-slate-800 border-slate-600 text-slate-500 dark:text-slate-400'
                }`}
            >
              {h.label}
            </button>
          ))}
        </div>
      </div>

      {/* Legend + search */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 text-xs items-center flex-wrap">
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-500" /> Healthy</span>
          <span className="flex items-center gap-1 ml-3"><span className="w-3 h-3 rounded bg-yellow-500" /> Warning</span>
          <span className="flex items-center gap-1 ml-3"><span className="w-3 h-3 rounded bg-red-500" /> Critical</span>
          <span className="flex items-center gap-1 ml-3"><span className="w-3 h-3 rounded border-2 border-amber-400" /> Search match</span>
          <span className="text-slate-400 ml-3 hidden sm:inline">· Click a node to open agent chat</span>
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
            onNodeClick={onNodeClick}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.25 }}
            minZoom={0.15}
            maxZoom={2.5}
            onInit={setRfInstance}
            attributionPosition="bottom-left"
          >
            <Background color="#334155" gap={24} />
            <Controls showInteractive={true} showFitView={true} showZoom={true} />
            <MiniMap
              nodeColor={(n) => {
                const d = n.data as { heatmapValue: number };
                if (d.heatmapValue >= 80) return '#ef4444';
                if (d.heatmapValue >= 60) return '#eab308';
                return '#22c55e';
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
              <p>View: <span className="text-slate-900 dark:text-white">{layerLabel(view)}</span></p>
              <p>Heatmap: <span className="text-slate-900 dark:text-white">{heatmap}</span></p>
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
                Open Agent Chat
              </button>
            </div>
          )}

          {paths && (
            <div className="p-4 bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-2">Dependency Paths</h3>
              <div className="space-y-3 text-xs">
                <div>
                  <p className="text-slate-500 mb-1">↑ Upstream ({paths.upstream.length})</p>
                  {paths.upstream.length === 0 ? (
                    <p className="text-slate-500 dark:text-slate-600">None</p>
                  ) : (
                    paths.upstream.map((p) => (
                      <div key={p.node} className="flex items-center gap-1 mb-1">
                        <button
                          onClick={() => setSelectedNodeId(p.node)}
                          className="flex-1 text-left px-2 py-1 rounded hover:bg-slate-100 dark:hover:bg-slate-700 text-violet-700 dark:text-purple-300"
                        >
                          {p.node} <span className="text-slate-500">({p.relationship})</span>
                        </button>
                        <button title="Edit" onClick={() => handleEditEdge(p.node, selectedNodeId!)}
                          className="px-1.5 py-1 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white">✎</button>
                        <button title="Delete" onClick={() => handleDeleteEdge(p.node, selectedNodeId!)}
                          className="px-1.5 py-1 text-red-600 dark:text-red-400 hover:text-red-700 dark:text-red-300">×</button>
                      </div>
                    ))
                  )}
                </div>
                <div>
                  <p className="text-slate-500 mb-1">↓ Downstream ({paths.downstream.length})</p>
                  {paths.downstream.length === 0 ? (
                    <p className="text-slate-500 dark:text-slate-600">None</p>
                  ) : (
                    paths.downstream.map((p) => (
                      <div key={p.node} className="flex items-center gap-1 mb-1">
                        <button
                          onClick={() => setSelectedNodeId(p.node)}
                          className="flex-1 text-left px-2 py-1 rounded hover:bg-slate-100 dark:hover:bg-slate-700 text-blue-700 dark:text-blue-300"
                        >
                          {p.node} <span className="text-slate-500">({p.relationship})</span>
                        </button>
                        <button title="Edit" onClick={() => handleEditEdge(selectedNodeId!, p.node)}
                          className="px-1.5 py-1 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white">✎</button>
                        <button title="Delete" onClick={() => handleDeleteEdge(selectedNodeId!, p.node)}
                          className="px-1.5 py-1 text-red-600 dark:text-red-400 hover:text-red-700 dark:text-red-300">×</button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Node chat popup */}
      {nodePopupOpen && selectedNode && (
        <NodeChatPopup
          node={selectedNode}
          paths={paths}
          pathsLoading={pathsLoading}
          heatmapMetric={heatmap}
          onClose={closePopup}
        />
      )}
    </div>
  );
}
