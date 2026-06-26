import type { Node, Edge } from 'reactflow';
import type { DependencyGraph, ViewType } from '../types/api';
import * as dagre from 'dagre';

export type LayoutNode = 
  | { type: 'leaf'; id: string; nodeData?: any }
  | { type: 'group'; spec: HierarchicalGroupSpec };

export interface HierarchicalGroupSpec {
  id: string;
  label: string;
  palette: { bg: string; border: string; text: string };
  children: LayoutNode[];
}

const GRP_PAD = 20;
const GRP_HEADER = 34;
const GRP_NODE_W = 60;
const GRP_NODE_H = 60;
const GRP_GAP_X = 60;
const GRP_GAP_Y = 38;
const GRP_MAX_COLS = 3;

export const GROUP_PALETTE = [
  { bg: 'rgba(59,130,246,0.09)',  border: '#3b82f6', text: '#60a5fa' },
  { bg: 'rgba(139,92,246,0.09)', border: '#8b5cf6', text: '#a78bfa' },
  { bg: 'rgba(245,158,11,0.09)', border: '#f59e0b', text: '#fbbf24' },
  { bg: 'rgba(34,197,94,0.08)',  border: '#22c55e', text: '#4ade80' },
  { bg: 'rgba(239,68,68,0.08)',  border: '#ef4444', text: '#f87171' },
  { bg: 'rgba(168,85,247,0.09)', border: '#a855f7', text: '#c084fc' },
];

export const PLATFORM_PALETTE: Record<string, typeof GROUP_PALETTE[0]> = {
  aws:    { bg: 'rgba(245,158,11,0.12)',  border: '#f59e0b', text: '#fbbf24' },
  gcp:   { bg: 'rgba(34,197,94,0.12)',   border: '#22c55e', text: '#4ade80' },
  azure: { bg: 'rgba(99,102,241,0.12)',  border: '#6366f1', text: '#818cf8' },
  'on-prem-vmware':{ bg: 'rgba(59,130,246,0.12)',  border: '#3b82f6', text: '#60a5fa' },
  'on-prem-physical':{ bg: 'rgba(168,85,247,0.12)',  border: '#a855f7', text: '#c084fc' },
};

const FUNCTIONAL_CATEGORY_MAP: Record<string, 'compute' | 'storage' | 'network'> = {
  server:       'compute',
  container:    'compute',
  database:     'storage',
  cache:        'storage',
  load_balancer:'network',
  gateway:      'network',
  web_server:   'network',
};

const CATEGORY_META: Record<string, { label: string; palette: typeof GROUP_PALETTE[0] }> = {
  network: {
    label: 'Network',
    palette: { bg: 'rgba(34,197,94,0.10)', border: '#22c55e', text: '#4ade80' },
  },
  compute: {
    label: 'Compute',
    palette: { bg: 'rgba(59,130,246,0.10)', border: '#3b82f6', text: '#60a5fa' },
  },
  storage: {
    label: 'Storage',
    palette: { bg: 'rgba(245,158,11,0.10)', border: '#f59e0b', text: '#fbbf24' },
  },
};

export const PLATFORM_VIEWS: { id: ViewType; label: string }[] = [
  { id: 'on-prem-vmware', label: 'On-Prem VMware' },
  { id: 'on-prem-physical', label: 'On-Prem Physical' },
  { id: 'aws', label: 'AWS' },
  { id: 'gcp', label: 'GCP' },
  { id: 'azure', label: 'Azure' },
];

function getUpstreamAppOrBs(nodeId: string, graph: DependencyGraph): string | null {
  // Try to find application parent
  let parent = graph.edges.find(e => e.target === nodeId && e.relationship === 'contains')?.source;
  if (!parent) return null;
  const pNode = graph.nodes.find(n => n.id === parent);
  if (pNode?.layer === 'application' || pNode?.layer === 'business_service') return pNode.id;
  return null;
}

export function buildHierarchicalSpecs(graph: DependencyGraph, selectedViews: Set<ViewType>): LayoutNode[] {
  const views = Array.from(selectedViews);
  const platformIds = PLATFORM_VIEWS.map(p => p.id);
  const activePlatforms = views.filter(v => platformIds.includes(v as any));
  const hasPlatformView = activePlatforms.length > 0;
  
  const hasBS = views.includes('business_service');
  const hasMS = views.includes('microservice');

  const roots: LayoutNode[] = [];
  const assignedNodes = new Set<string>();

  // Helper to build microservice boxes based on app
  const buildMSBoxes = (msNodes: any[]) => {
    const msGroups = new Map<string, LayoutNode[]>();
    const strayMs: LayoutNode[] = [];
    
    msNodes.forEach(ms => {
      const parentId = getUpstreamAppOrBs(ms.id, graph);
      if (parentId) {
        if (!msGroups.has(parentId)) msGroups.set(parentId, []);
        msGroups.get(parentId)!.push({ type: 'leaf', id: ms.id });
      } else {
        strayMs.push({ type: 'leaf', id: ms.id });
      }
      assignedNodes.add(ms.id);
    });

    const boxes: LayoutNode[] = [];
    let cIdx = 1;
    msGroups.forEach((children, appId) => {
      const appNode = graph.nodes.find(n => n.id === appId);
      boxes.push({
        type: 'group',
        spec: {
          id: `grp-app-${appId}`,
          label: appNode?.label ?? appId,
          palette: GROUP_PALETTE[cIdx % GROUP_PALETTE.length],
          children,
        }
      });
      cIdx++;
    });
    
    // Wrap all ungrouped microservices in a single "Microservices" box
    if (strayMs.length > 0) {
      boxes.push({
        type: 'group',
        spec: {
          id: 'grp-all-microservices',
          label: 'Microservices',
          palette: GROUP_PALETTE[1], // purple
          children: strayMs,
        }
      });
    }
    return boxes;
  };

  if (hasPlatformView) {
    activePlatforms.forEach(plat => {
      const platNodes = graph.nodes.filter(n => n.platform === plat);
      const SERVICE_LAYERS = new Set(['business_service', 'microservice', 'application']);

      if (plat === 'on-prem-physical') {
        // Split into Network / Compute / Storage boxes
        const buckets: Record<'network' | 'compute' | 'storage', LayoutNode[]> = {
          network: [], compute: [], storage: [],
        };

        platNodes.forEach(pn => {
          if (SERVICE_LAYERS.has(pn.layer)) return;
          const cat = FUNCTIONAL_CATEGORY_MAP[pn.type] ?? 'compute';
          buckets[cat].push({ type: 'leaf', id: pn.id });
          assignedNodes.add(pn.id);
        });

        (['network', 'compute', 'storage'] as const).forEach(cat => {
          if (buckets[cat].length === 0) return;
          const meta = CATEGORY_META[cat];
          roots.push({
            type: 'group',
            spec: {
              id: `grp-plat-${plat}-${cat}`,
              label: meta.label,
              palette: meta.palette,
              children: buckets[cat],
            },
          });
        });
      } else {
        // Other platforms: group by region
        const regionGroups = new Map<string, LayoutNode[]>();
        const strays: LayoutNode[] = [];

        platNodes.forEach(pn => {
          if (SERVICE_LAYERS.has(pn.layer)) return;
          if (pn.region) {
            if (!regionGroups.has(pn.region)) regionGroups.set(pn.region, []);
            regionGroups.get(pn.region)!.push({ type: 'leaf', id: pn.id });
          } else {
            strays.push({ type: 'leaf', id: pn.id });
          }
          assignedNodes.add(pn.id);
        });

        const pLabel = PLATFORM_VIEWS.find(p => p.id === plat)?.label ?? plat;
        regionGroups.forEach((ch, regionId) => {
          roots.push({
            type: 'group',
            spec: {
              id: `grp-plat-reg-${plat}-${regionId.replace(/[^a-zA-Z0-9]/g, '-')}`,
              label: `${pLabel} (${regionId})`,
              palette: PLATFORM_PALETTE[plat] ?? GROUP_PALETTE[0],
              children: ch,
            },
          });
        });

        if (strays.length > 0) {
          roots.push({
            type: 'group',
            spec: {
              id: `grp-plat-reg-${plat}-other`,
              label: `${pLabel} (Other)`,
              palette: PLATFORM_PALETTE[plat] ?? GROUP_PALETTE[0],
              children: strays,
            },
          });
        }
      }
    });
  }

  // Business Services Box
  if (hasBS) {
    const bsNodes = graph.nodes.filter(n => n.layer === 'business_service');
    if (bsNodes.length > 0) {
      bsNodes.forEach(n => assignedNodes.add(n.id));
      roots.push({
        type: 'group',
        spec: {
          id: 'grp-layer-business_service',
          label: 'Business Services',
          palette: GROUP_PALETTE[0],
          children: bsNodes.map(n => ({ type: 'leaf', id: n.id }))
        }
      });
    }
  }

  // Microservices outside platform grouping
  if (hasMS) {
    const msNodes = graph.nodes.filter(n => n.layer === 'microservice' && !assignedNodes.has(n.id));
    if (msNodes.length > 0) {
      roots.push(...buildMSBoxes(msNodes));
    }
  }

  // Only surface service-layer nodes that weren't placed in any group.
  // Infrastructure/platform nodes without an active platform view are hidden rather
  // than rendered as floating orphans on the canvas.
  const SERVICE_LAYER_SET = new Set(['business_service', 'microservice', 'application']);
  graph.nodes.forEach(n => {
    if (!assignedNodes.has(n.id) && SERVICE_LAYER_SET.has(n.layer)) {
      roots.push({ type: 'leaf', id: n.id });
    }
  });

  return roots;
}

export interface ComputedLayoutNode {
  node: LayoutNode;
  width: number;
  height: number;
  x: number; // Relative to parent
  y: number; // Relative to parent
  children: ComputedLayoutNode[];
}

export function calcTreeLayout(nodes: LayoutNode[]): ComputedLayoutNode[] {
  // For roots, they will be laid out by Dagre, so their relative x,y don't matter,
  // but we must compute their absolute widths and heights.
  return nodes.map(n => layoutNode(n));
}

function layoutNode(node: LayoutNode): ComputedLayoutNode {
  if (node.type === 'leaf') {
    return { node, width: GRP_NODE_W, height: GRP_NODE_H, x: 0, y: 0, children: [] };
  }

  // Layout group children
  const computedChildren = node.spec.children.map(c => layoutNode(c));
  
  // Arrange children in a grid
  // Simple square-ish grid
  const cols = Math.max(1, Math.min(GRP_MAX_COLS, Math.ceil(Math.sqrt(computedChildren.length))));
  let currentX = GRP_PAD;
  let currentY = GRP_HEADER + GRP_PAD;
  let rowMaxHeight = 0;
  
  let totalWidth = 0;
  let totalHeight = 0;

  computedChildren.forEach((child, i) => {
    if (i > 0 && i % cols === 0) {
      currentX = GRP_PAD;
      currentY += rowMaxHeight + GRP_GAP_Y;
      rowMaxHeight = 0;
    }
    
    child.x = currentX;
    child.y = currentY;
    
    currentX += child.width + GRP_GAP_X;
    rowMaxHeight = Math.max(rowMaxHeight, child.height);
    
    totalWidth = Math.max(totalWidth, currentX - GRP_GAP_X + GRP_PAD);
    totalHeight = Math.max(totalHeight, currentY + rowMaxHeight + GRP_PAD);
  });

  if (computedChildren.length === 0) {
    totalWidth = 200;
    totalHeight = 100;
  }

  return { node, width: totalWidth, height: totalHeight, x: 0, y: 0, children: computedChildren };
}

export function flattenComputedLayout(
  computedRoots: ComputedLayoutNode[],
  graph: DependencyGraph,
  selectedNodeId: string | null,
  highlightIds: Set<string>
): Node[] {
  const rfNodes: Node[] = [];
  const isHighlighting = highlightIds.size > 0;

  function traverse(computed: ComputedLayoutNode, parentId?: string): boolean {
    let hasHighlightedChild = false;

    const cnode = computed.node;
    if (cnode.type === 'leaf') {
      const gNode = graph.nodes.find(n => n.id === cnode.id);
      if (!gNode) return false;
      const isDimmed = isHighlighting && !highlightIds.has(gNode.id);
      hasHighlightedChild = !isDimmed;
      
      rfNodes.push({
        id: gNode.id,
        type: 'dependency',
        position: { x: computed.x, y: computed.y },
        ...(parentId ? { parentId, extent: 'parent' } : {}),
        data: {
          label: gNode.label,
          type: gNode.type,
          layer: gNode.layer,
          health: gNode.health,
          heatmapValue: gNode.heatmap_value,
          heatmapMetric: graph.heatmap,
          isSelected: gNode.id === selectedNodeId,
          isHighlighted: isHighlighting && highlightIds.has(gNode.id),
          isSearchMatch: false,
          dimmed: isDimmed,
        }
      });
      return hasHighlightedChild;
    } else {
      const spec = cnode.spec;

      const groupNodeIdx = rfNodes.length;
      rfNodes.push({
        id: spec.id,
        type: 'nodeGroup',
        position: { x: computed.x, y: computed.y },
        ...(parentId ? { parentId, extent: 'parent' } : {}),
        style: {
          width: computed.width,
          height: computed.height,
          backgroundColor: spec.palette.bg,
          border: `1.5px solid ${spec.palette.border}`,
          borderRadius: 12,
          opacity: 1,
          filter: 'none',
          transition: 'opacity 0.35s ease, filter 0.35s ease',
        },
        data: { label: spec.label, textColor: spec.palette.text },
        selectable: false,
        draggable: true,
      });

      computed.children.forEach(c => {
        if (traverse(c, spec.id)) hasHighlightedChild = true;
      });

      // Dim group boxes that have no highlighted children
      if (isHighlighting && !hasHighlightedChild) {
        rfNodes[groupNodeIdx].style!.opacity = 0.12;
        rfNodes[groupNodeIdx].style!.filter = 'blur(2px) grayscale(0.5)';
      }

      return hasHighlightedChild;
    }
  }

  computedRoots.forEach(c => traverse(c));
  return rfNodes;
}

export function getGroupLayoutedNodesDagre(rfNodes: Node[], edges: Edge[]): Node[] {
  // Only root nodes get positioned by Dagre
  const rootNodes = rfNodes.filter(n => !n.parentId);
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  dagreGraph.setGraph({ rankdir: 'LR', nodesep: 60, ranksep: 130 });

  rootNodes.forEach(n => {
    dagreGraph.setNode(n.id, { width: (n.style?.width as number) || 80, height: (n.style?.height as number) || 80 });
  });

  edges.forEach(e => {
    // We only route edges between root nodes in dagre.
    // To do this properly, we must find the root ancestor of e.source and e.target
    const getRoot = (id: string): Node | null => {
      let current = rfNodes.find(n => n.id === id);
      while (current && current.parentId) {
        current = rfNodes.find(n => n.id === current!.parentId);
      }
      return current ?? null;
    };
    const srcRoot = getRoot(e.source);
    const tgtRoot = getRoot(e.target);
    if (srcRoot && tgtRoot && srcRoot.id !== tgtRoot.id) {
      // Determine the ideal order: BS -> MS -> Platform
      const getLayerRank = (nodeId: string): number => {
        if (nodeId === 'grp-layer-business_service') return 1;
        if (nodeId.startsWith('grp-app-') || nodeId === 'grp-all-microservices' || nodeId.startsWith('grp-layer-')) return 2;
        if (nodeId.startsWith('grp-plat-') || nodeId.startsWith('grp-category-')) return 3;
        // Fallback for raw nodes:
        const leaf = rfNodes.find(n => n.id === nodeId);
        if (leaf?.data?.layer === 'business_service') return 1;
        if (leaf?.data?.layer === 'microservice' || leaf?.data?.layer === 'application') return 2;
        return 3;
      };

      const srcRank = getLayerRank(srcRoot.id);
      const tgtRank = getLayerRank(tgtRoot.id);

      // Force Dagre to place nodes horizontally from left to right.
      // If an edge flows backwards (e.g. Platform -> BS), we reverse it just for layout purposes!
      if (srcRank <= tgtRank) {
        dagreGraph.setEdge(srcRoot.id, tgtRoot.id);
      } else {
        dagreGraph.setEdge(tgtRoot.id, srcRoot.id);
      }
    }
  });

  dagre.layout(dagreGraph);

  return rfNodes.map(n => {
    if (n.parentId) return n; // Keep relative position
    const pos = dagreGraph.node(n.id);
    if (!pos) return n;
    const w = (n.style?.width as number) || 80;
    const h = (n.style?.height as number) || 80;
    return { ...n, position: { x: pos.x - w / 2, y: pos.y - h / 2 } };
  });
}
