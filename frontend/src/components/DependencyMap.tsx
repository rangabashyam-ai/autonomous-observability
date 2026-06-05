import { useCallback, useEffect, useMemo, useState } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  MarkerType,
  type Node,
  type Edge,
} from 'reactflow';
import 'reactflow/dist/style.css';

import DependencyNode from './DependencyNode';
import {
  getDependencyGraph,
  getDependencyPaths,
  addDependency,
  deleteDependency,
  uploadCsvDependencies,
  uploadJsonDependency,
} from '../api/client';
import type { DependencyGraph, DependencyPath, HeatmapMetric, ViewType } from '../types/api';
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

function layoutNodes(graph: DependencyGraph, selectedId: string | null): Node[] {
  const layers: Record<string, number> = {};
  graph.nodes.forEach((n) => {
    layers[n.layer] = (layers[n.layer] ?? 0) + 1;
  });

  const layerIndex: Record<string, number> = {};
  const layerCounts: Record<string, number> = {};
  graph.nodes.forEach((n) => {
    layerCounts[n.layer] = (layerCounts[n.layer] ?? 0) + 1;
  });

  const layerOrder = [
    'business_service',
    'application',
    'microservice',
    'container',
    'platform',
    'server',
    'rack',
    'network',
  ];

  return graph.nodes.map((node) => {
    const li = layerOrder.indexOf(node.layer);
    const yLayer = li >= 0 ? li : 0;
    layerIndex[node.layer] = (layerIndex[node.layer] ?? 0) + 1;
    const idx = layerIndex[node.layer];
    const count = layerCounts[node.layer];
    const x = (idx - (count + 1) / 2) * 200;
    const y = yLayer * 120;

    return {
      id: node.id,
      type: 'dependency',
      position: { x, y },
      data: {
        label: node.label,
        type: node.type,
        layer: node.layer,
        health: node.health,
        heatmapValue: node.heatmap_value,
        heatmapMetric: graph.heatmap,
        isSelected: node.id === selectedId,
        isHighlighted: false,
      },
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

export default function DependencyMap() {
  const [view, setView] = useState<ViewType>('business_service');
  const [heatmap, setHeatmap] = useState<HeatmapMetric>('cpu');
  const [graph, setGraph] = useState<DependencyGraph | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [paths, setPaths] = useState<DependencyPath | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newDep, setNewDep] = useState({ source: '', target: '', relationship: 'calls' });

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
      setNodes(layoutNodes(data, selectedNodeId));
      setEdges(buildEdges(data, highlightIds));
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
      setNodes(layoutNodes(graph, selectedNodeId));
      setEdges(buildEdges(graph, highlightIds));
    }
  }, [selectedNodeId, paths, graph, highlightIds, setNodes, setEdges]);

  useEffect(() => {
    if (!selectedNodeId) {
      setPaths(null);
      return;
    }
    getDependencyPaths(selectedNodeId)
      .then(setPaths)
      .catch(() => setPaths(null));
  }, [selectedNodeId]);

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNodeId(node.id);
  }, []);

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

  const selectedNode = graph?.nodes.find((n) => n.id === selectedNodeId);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Dependency Mapping</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Interactive topology · zoom from business services to infrastructure
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
          <button onClick={handleAddDependency} className="px-4 py-1.5 text-sm bg-green-600 rounded-lg">
            Save
          </button>
        </div>
      )}

      <div className="flex flex-wrap gap-4">
        <div className="flex flex-wrap gap-1">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              onClick={() => {
                setView(v.id);
                setSelectedNodeId(null);
              }}
              className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                view === v.id
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
              className={`px-2 py-1 text-[10px] rounded border transition-colors ${
                heatmap === h.id
                  ? 'bg-emerald-600/30 border-emerald-500 text-emerald-300'
                  : 'bg-slate-100 dark:bg-slate-800 border-slate-600 text-slate-500 dark:text-slate-400'
              }`}
            >
              {h.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-1 text-xs">
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-500" /> Healthy</span>
        <span className="flex items-center gap-1 ml-3"><span className="w-3 h-3 rounded bg-yellow-500" /> Warning</span>
        <span className="flex items-center gap-1 ml-3"><span className="w-3 h-3 rounded bg-red-500" /> Critical</span>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
        <div className="xl:col-span-3 h-[600px] bg-slate-100 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden relative">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-50 dark:bg-slate-900/80 z-10">
              <span className="text-slate-500 dark:text-slate-400">Loading graph...</span>
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
            minZoom={0.2}
            maxZoom={2}
          >
            <Background color="#334155" gap={20} />
            <Controls />
            <MiniMap
              nodeColor={(n) => {
                const d = n.data as { heatmapValue: number };
                if (d.heatmapValue >= 80) return '#ef4444';
                if (d.heatmapValue >= 60) return '#eab308';
                return '#22c55e';
              }}
              maskColor="rgb(15 23 42 / 0.8)"
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
          </div>

          {selectedNode && (
            <div className="p-4 bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{selectedNode.label}</h3>
                <span className={`text-[10px] px-2 py-0.5 rounded border ${healthBadgeClass(selectedNode.health)}`}>
                  {selectedNode.health}
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">{selectedNode.type} · {layerLabel(selectedNode.layer)}</p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                {Object.entries(selectedNode.metrics).map(([k, v]) => (
                  <div key={k} className="bg-slate-100 dark:bg-slate-900/50 rounded px-2 py-1">
                    <span className="text-slate-500">{k}: </span>
                    <span className="text-slate-900 dark:text-white font-mono">{typeof v === 'number' ? v.toFixed(1) : v}</span>
                  </div>
                ))}
              </div>
              <button
                onClick={() => loadGraph()}
                className="mt-3 w-full text-xs py-1.5 bg-violet-100 dark:bg-purple-600/30 border border-violet-300 dark:border-purple-500/50 rounded-lg text-violet-800 dark:text-purple-300"
              >
                Focus & Zoom In
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
                        <button
                          title="Edit"
                          onClick={() => handleEditEdge(p.node, selectedNodeId!)}
                          className="px-1.5 py-1 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                        >
                          ✎
                        </button>
                        <button
                          title="Delete"
                          onClick={() => handleDeleteEdge(p.node, selectedNodeId!)}
                          className="px-1.5 py-1 text-red-600 dark:text-red-400 hover:text-red-700 dark:text-red-300"
                        >
                          ×
                        </button>
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
                        <button
                          title="Edit"
                          onClick={() => handleEditEdge(selectedNodeId!, p.node)}
                          className="px-1.5 py-1 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                        >
                          ✎
                        </button>
                        <button
                          title="Delete"
                          onClick={() => handleDeleteEdge(selectedNodeId!, p.node)}
                          className="px-1.5 py-1 text-red-600 dark:text-red-400 hover:text-red-700 dark:text-red-300"
                        >
                          ×
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
