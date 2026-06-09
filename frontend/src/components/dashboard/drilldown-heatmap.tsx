import { useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import { cn } from '../../lib/cn';
import { Card, CardHeader, CardTitle } from '../ui/card';
import { HealthBadge } from '../ui/badge';
import InlineCopilot from '../copilot/InlineCopilot';

interface DrilldownHeatmapProps {
  title: string;
  description: string;
  type: 'nodes' | 'pods' | 'apis';
  data: any[];
  containers?: any[];
}

function heatColor(value: number): string {
  if (value >= 85) return 'bg-critical hover:shadow-lg hover:shadow-critical/50';
  if (value >= 70) return 'bg-warning hover:shadow-lg hover:shadow-warning/50';
  if (value >= 50) return 'bg-warning/70 hover:shadow-lg hover:shadow-warning/40';
  if (value >= 30) return 'bg-success/70 hover:shadow-lg hover:shadow-success/40';
  return 'bg-success/50 hover:shadow-lg hover:shadow-success/30';
}

function getHealthColor(value: number): string {
  if (value >= 85) return '#EF4444';
  if (value >= 70) return '#F59E0B';
  if (value >= 50) return '#FBBF24';
  if (value >= 30) return '#86EFAC';
  return '#10B981';
}

function getPodsForNode(_nodeId: string, containers: any[]) {
  return containers.filter((_: any) => Math.random() > 0.5).slice(0, 8);
}

export function DrilldownHeatmap({ title, description, type, data, containers = [] }: DrilldownHeatmapProps) {
  const [selectedItem, setSelectedItem] = useState<string | null>(null);
  const [selectedPod, setSelectedPod] = useState<string | null>(null);
  const [selectedApi, setSelectedApi] = useState<string | null>(null);

  // ============ POD DETAIL VIEW (works for both nodes and pods view types) ============
  if (selectedPod) {
    const pod = containers.find((c: any) => c.id === selectedPod);
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <button onClick={() => setSelectedPod(null)} className="p-1.5 hover:bg-card-hover rounded-lg transition-colors">
              <ChevronLeft className="h-5 w-5" />
            </button>
            <div>
              <CardTitle className="text-lg">Pod Details</CardTitle>
              <p className="text-sm font-mono text-text-secondary mt-0.5">{pod?.id}</p>
            </div>
          </div>
        </CardHeader>
        <div className="p-6 space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 rounded-xl bg-gradient-to-br from-primary/10 to-primary/5 border border-primary/20">
              <p className="text-xs text-text-secondary mb-2 font-medium">Status</p>
              <HealthBadge health={pod?.status} />
            </div>
            <div className="p-4 rounded-xl bg-gradient-to-br from-warning/10 to-warning/5 border border-warning/20">
              <p className="text-xs text-text-secondary mb-2 font-medium">Health Score</p>
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full" style={{ backgroundColor: getHealthColor((pod?.cpu + pod?.memory) / 2) }} />
                <span className="text-sm font-semibold">{((pod?.cpu + pod?.memory) / 2).toFixed(0)}%</span>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 rounded-xl border border-border">
              <p className="text-xs text-text-secondary mb-3 font-medium">CPU Usage</p>
              <p className="text-3xl font-bold text-primary mb-3">{pod?.cpu.toFixed(1)}%</p>
              <div className="h-2 bg-border rounded-full overflow-hidden">
                <div className="h-full bg-primary rounded-full" style={{ width: `${Math.min(100, pod?.cpu)}%` }} />
              </div>
            </div>
            <div className="p-4 rounded-xl border border-border">
              <p className="text-xs text-text-secondary mb-3 font-medium">Memory Usage</p>
              <p className="text-3xl font-bold text-warning mb-3">{pod?.memory.toFixed(1)}%</p>
              <div className="h-2 bg-border rounded-full overflow-hidden">
                <div className="h-full bg-warning rounded-full" style={{ width: `${Math.min(100, pod?.memory)}%` }} />
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 rounded-xl border border-border">
              <p className="text-xs text-text-secondary mb-2 font-medium">Node</p>
              <p className="text-sm font-mono font-semibold">k8s-node-01</p>
            </div>
            <div className="p-4 rounded-xl border border-border">
              <p className="text-xs text-text-secondary mb-2 font-medium">Cluster</p>
              <p className="text-sm font-mono font-semibold">k8s-cluster-a</p>
            </div>
          </div>

          {pod && (
            <div className="mt-6 border-t border-border pt-6">
              <InlineCopilot
                pageType="service"
                selectedEntity={pod.id}
                entityData={{
                  pod_id: pod.id,
                  status: pod.status,
                  cpu: pod.cpu,
                  memory: pod.memory,
                  node: 'k8s-node-01',
                  cluster: 'k8s-cluster-a',
                }}
                relatedMetrics={{
                  cpu: pod.cpu,
                  memory: pod.memory,
                }}
                title={`AI Assistant: ${pod.id.split('-').pop()}`}
                subtitle={`Ask questions about pod ${pod.id.split('-').pop()} only`}
                suggestedQuestions={[
                  `Why is pod ${pod.id.split('-').pop()} status ${pod.status}?`,
                  `Analyze CPU utilization for ${pod.id.split('-').pop()}`,
                  `Recommend remediation steps for pod status`,
                ]}
              />
            </div>
          )}
        </div>
      </Card>
    );
  }

  // ============ API DETAIL VIEW ============
  if (type === 'apis' && selectedApi) {
    const api = data.find((a) => a.name === selectedApi);
    const score = Math.min(100, api.latency_ms / 3 + api.error_rate * 20);
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <button onClick={() => setSelectedApi(null)} className="p-1.5 hover:bg-card-hover rounded-lg transition-colors">
              <ChevronLeft className="h-5 w-5" />
            </button>
            <div>
              <CardTitle className="text-lg">API Details</CardTitle>
              <p className="text-sm font-mono text-text-secondary mt-0.5">{api?.name}</p>
            </div>
          </div>
        </CardHeader>
        <div className="p-6 space-y-6">
          <div className="grid grid-cols-3 gap-4">
            <div className="p-4 rounded-xl bg-gradient-to-br from-primary/10 to-primary/5 border border-primary/20">
              <p className="text-xs text-text-secondary mb-2 font-medium">Latency</p>
              <p className="text-3xl font-bold text-primary">{api?.latency_ms.toFixed(1)}ms</p>
              <p className="text-xs text-text-secondary mt-2">Response Time</p>
            </div>
            <div className="p-4 rounded-xl bg-gradient-to-br from-warning/10 to-warning/5 border border-warning/20">
              <p className="text-xs text-text-secondary mb-2 font-medium">Error Rate</p>
              <p className="text-3xl font-bold text-warning">{api?.error_rate.toFixed(2)}%</p>
              <p className="text-xs text-text-secondary mt-2">Failed Requests</p>
            </div>
            <div className="p-4 rounded-xl bg-gradient-to-br from-success/10 to-success/5 border border-success/20">
              <p className="text-xs text-text-secondary mb-2 font-medium">Requests/sec</p>
              <p className="text-3xl font-bold text-success">{api?.requests_per_sec.toFixed(0)}</p>
              <p className="text-xs text-text-secondary mt-2">Throughput</p>
            </div>
          </div>
          <div className="p-4 rounded-xl border border-border">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold">Health Score</p>
              <span className={cn(
                'px-3 py-1 rounded-lg font-bold text-sm text-white',
                score >= 85 ? 'bg-critical' : score >= 70 ? 'bg-warning' : 'bg-success'
              )}>
                {score.toFixed(0)}%
              </span>
            </div>
            <div className="w-full h-3 bg-border rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${Math.min(100, score)}%`, backgroundColor: getHealthColor(score) }}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 rounded-xl border border-border">
              <p className="text-xs text-text-secondary mb-2 font-medium">Status</p>
              <HealthBadge health={score >= 85 ? 'critical' : score >= 70 ? 'warning' : 'healthy'} />
            </div>
            <div className="p-4 rounded-xl border border-border">
              <p className="text-xs text-text-secondary mb-2 font-medium">Environment</p>
              <p className="text-sm font-mono font-semibold">Production</p>
            </div>
          </div>

          {api && (
            <div className="mt-6 border-t border-border pt-6">
              <InlineCopilot
                pageType="service"
                selectedEntity={api.name}
                entityData={{
                  api_route: api.name,
                  latency_ms: api.latency_ms,
                  error_rate: api.error_rate,
                  throughput_rps: api.requests_per_sec,
                  score: score,
                }}
                relatedMetrics={{
                  latency: api.latency_ms,
                  error_rate: api.error_rate,
                  throughput: api.requests_per_sec,
                }}
                title={`AI Assistant: API Gateway`}
                subtitle={`Ask questions about API route ${api.name} only`}
                suggestedQuestions={[
                  `Analyze latency for API endpoint ${api.name}`,
                  `Explain the error rate of ${api.error_rate}% for ${api.name}`,
                  `Is ${api.requests_per_sec} RPS normal for this API endpoint?`,
                ]}
              />
            </div>
          )}
        </div>
      </Card>
    );
  }

  // ============ NODE DETAIL VIEW ============
  if (type === 'nodes' && selectedItem && !selectedPod) {
    const node = data.find((n) => n.id === selectedItem);
    const nodePods = getPodsForNode(selectedItem, containers);
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <button onClick={() => setSelectedItem(null)} className="p-1.5 hover:bg-card-hover rounded-lg transition-colors">
              <ChevronLeft className="h-5 w-5" />
            </button>
            <div>
              <CardTitle className="text-lg">Node: {node?.id}</CardTitle>
              <p className="text-sm text-text-secondary mt-0.5">{nodePods.length} pods running</p>
            </div>
          </div>
        </CardHeader>
        <div className="p-6 space-y-6">
          <div className="grid grid-cols-3 gap-4">
            <div className="p-4 rounded-xl border border-primary/20 bg-gradient-to-br from-primary/5 to-transparent">
              <p className="text-xs text-text-secondary mb-2 font-medium">CPU Usage</p>
              <p className="text-3xl font-bold text-primary mb-3">{node?.cpu.toFixed(1)}%</p>
              <div className="h-2 bg-primary/20 rounded-full overflow-hidden">
                <div className="h-full bg-primary rounded-full" style={{ width: `${Math.min(100, node?.cpu)}%` }} />
              </div>
            </div>
            <div className="p-4 rounded-xl border border-warning/20 bg-gradient-to-br from-warning/5 to-transparent">
              <p className="text-xs text-text-secondary mb-2 font-medium">Memory Usage</p>
              <p className="text-3xl font-bold text-warning mb-3">{node?.memory.toFixed(1)}%</p>
              <div className="h-2 bg-warning/20 rounded-full overflow-hidden">
                <div className="h-full bg-warning rounded-full" style={{ width: `${Math.min(100, node?.memory)}%` }} />
              </div>
            </div>
            <div className="p-4 rounded-xl border border-success/20 bg-gradient-to-br from-success/5 to-transparent">
              <p className="text-xs text-text-secondary mb-2 font-medium">Storage</p>
              <p className="text-3xl font-bold text-success mb-3">{node?.storage.toFixed(1)}%</p>
              <div className="h-2 bg-success/20 rounded-full overflow-hidden">
                <div className="h-full bg-success rounded-full" style={{ width: `${Math.min(100, node?.storage)}%` }} />
              </div>
            </div>
          </div>
          <div>
            <h4 className="text-sm font-semibold mb-4 flex items-center gap-2">
              <span className="w-2 h-2 bg-primary rounded-full"></span>
              Pods on this Node ({nodePods.length})
            </h4>
            <div className="space-y-2 max-h-96 overflow-y-auto pr-2">
              {nodePods.map((pod: any) => (
                <button
                  key={pod.id}
                  onClick={() => setSelectedPod(pod.id)}
                  className="w-full p-3 rounded-lg border border-border hover:border-primary/50 hover:bg-card-hover transition-all group"
                >
                  <div className="flex items-center justify-between">
                    <div className="text-left flex-1">
                      <p className="text-sm font-mono font-semibold group-hover:text-primary transition-colors">{pod.id}</p>
                      <p className="text-xs text-text-secondary mt-1">CPU: {pod.cpu.toFixed(1)}% | Mem: {pod.memory.toFixed(1)}%</p>
                    </div>
                    <HealthBadge health={pod.status} />
                  </div>
                </button>
              ))}
            </div>
          </div>

          {node && (
            <div className="mt-6 border-t border-border pt-6">
              <InlineCopilot
                pageType="service"
                selectedEntity={node.id}
                entityData={{
                  node_id: node.id,
                  cpu: node.cpu,
                  memory: node.memory,
                  storage: node.storage,
                  pods_count: nodePods.length,
                  pods: nodePods.map((p: any) => ({ id: p.id, status: p.status, cpu: p.cpu, memory: p.memory })),
                }}
                relatedMetrics={{
                  cpu: node.cpu,
                  memory: node.memory,
                  storage: node.storage,
                }}
                title={`AI Assistant: Node ${node.id}`}
                subtitle={`Ask questions about node ${node.id} only`}
                suggestedQuestions={[
                  `Summarize the health status of node ${node.id}`,
                  `Analyze node ${node.id} resource consumption (CPU: ${node.cpu}%, Mem: ${node.memory}%)`,
                  `Are the pods on node ${node.id} running healthily?`,
                ]}
              />
            </div>
          )}
        </div>
      </Card>
    );
  }

  // ============ NODES GRID VIEW ============
  if (type === 'nodes' && !selectedItem) {
    return (
      <Card>
        <CardHeader>
          <div>
            <CardTitle>{title}</CardTitle>
            <p className="text-sm text-text-secondary mt-1">{description}</p>
          </div>
        </CardHeader>
        <div className="p-6">
          <div className="grid grid-cols-5 gap-3 mb-4">
            {data.slice(0, 20).map((node) => {
              const score = (node.cpu + node.memory + node.storage) / 3;
              return (
                <button
                  key={node.id}
                  onClick={() => setSelectedItem(node.id)}
                  className={cn(
                    'group relative p-4 rounded-xl border-2 border-border transition-all duration-200',
                    'hover:scale-105 hover:border-primary hover:shadow-lg',
                    heatColor(score)
                  )}
                >
                  <div className="relative z-10 space-y-3">
                    <p className="text-xs font-mono font-semibold text-text-primary truncate">{node.id}</p>
                    <div>
                      <div className="flex justify-between items-center text-[11px] mb-1.5">
                        <span className="text-text-secondary font-medium">CPU</span>
                        <span className="font-bold text-text-primary">{node.cpu.toFixed(0)}%</span>
                      </div>
                      <div className="h-1.5 bg-white/20 rounded-full overflow-hidden">
                        <div 
                          className="h-full rounded-full transition-all" 
                          style={{ width: `${Math.min(100, node.cpu)}%`, backgroundColor: getHealthColor(node.cpu) }}
                        />
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
          <p className="text-xs text-text-secondary font-medium">Click any node to see pods running on it</p>
        </div>
      </Card>
    );
  }

  // ============ PODS GRID VIEW ============
  if (type === 'pods' && !selectedPod) {
    return (
      <Card>
        <CardHeader>
          <div>
            <CardTitle>{title}</CardTitle>
            <p className="text-sm text-text-secondary mt-1">{description}</p>
          </div>
        </CardHeader>
        <div className="p-6">
          <div className="grid grid-cols-6 gap-3 mb-4">
            {containers.slice(0, 24).map((pod: any) => {
              const score = (pod.cpu + pod.memory) / 2;
              return (
                <button
                  key={pod.id}
                  onClick={() => setSelectedPod(pod.id)}
                  className={cn(
                    'group relative p-3 rounded-xl border-2 border-border transition-all duration-200',
                    'hover:scale-110 hover:border-primary hover:shadow-lg',
                    heatColor(score)
                  )}
                >
                  <div className="relative z-10 space-y-2">
                    <p className="text-[10px] font-mono font-semibold text-text-primary truncate text-center">{pod.id.split('-').pop()}</p>
                    <div>
                      <div className="flex justify-between items-center text-[9px] mb-1">
                        <span className="text-text-secondary">CPU</span>
                        <span className="font-bold text-text-primary">{pod.cpu.toFixed(0)}%</span>
                      </div>
                      <div className="h-1 bg-white/20 rounded-full overflow-hidden">
                        <div 
                          className="h-full rounded-full" 
                          style={{ width: `${Math.min(100, pod.cpu)}%`, backgroundColor: getHealthColor(pod.cpu) }}
                        />
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
          <p className="text-xs text-text-secondary font-medium">Click any pod to see full details (CPU, memory, node, cluster)</p>
        </div>
      </Card>
    );
  }

  // ============ API GATEWAY VIEW ============
  if (type === 'apis') {
    return (
      <Card>
        <CardHeader>
          <div>
            <CardTitle>{title}</CardTitle>
            <p className="text-sm text-text-secondary mt-1">{description}</p>
          </div>
        </CardHeader>
        <div className="p-6 space-y-3">
          {data.map((api) => {
            const score = Math.min(100, api.latency_ms / 3 + api.error_rate * 20);
            return (
              <button
                key={api.name}
                onClick={() => setSelectedApi(api.name)}
                className="w-full group p-4 rounded-xl border-2 border-border hover:border-primary/50 hover:bg-card-hover transition-all cursor-pointer text-left"
              >
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-mono font-bold text-text-primary group-hover:text-primary transition-colors truncate">{api.name}</p>
                    <div className="grid grid-cols-3 gap-4 mt-2 text-[11px] text-text-secondary">
                      <span>Latency: <span className="font-semibold text-text-primary">{api.latency_ms.toFixed(1)}ms</span></span>
                      <span>Error: <span className="font-semibold text-text-primary">{api.error_rate.toFixed(2)}%</span></span>
                      <span>RPS: <span className="font-semibold text-text-primary">{api.requests_per_sec.toFixed(0)}</span></span>
                    </div>
                  </div>
                  <div className={cn(
                    'flex-shrink-0 px-3 py-2 rounded-lg font-semibold text-xs text-white whitespace-nowrap',
                    score >= 85 ? 'bg-critical' : score >= 70 ? 'bg-warning' : 'bg-success'
                  )}>
                    {score.toFixed(0)}%
                  </div>
                </div>
                <div className="w-full h-2.5 bg-border rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${Math.min(100, score)}%`, backgroundColor: getHealthColor(score) }}
                  />
                </div>
              </button>
            );
          })}
        </div>
      </Card>
    );
  }

  return null;
}
