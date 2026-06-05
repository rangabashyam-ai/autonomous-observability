import { useState } from 'react';
import { X } from 'lucide-react';

interface ResourceTileProps {
  id: string;
  name: string;
  type: 'node' | 'pod' | 'api' | 'database' | 'queue' | 'server';
  primaryMetric: { label: string; value: number; unit: string };
  health: 'healthy' | 'warning' | 'critical';
  metrics?: {
    cpu?: number;
    memory?: number;
    storage?: number;
    network?: number;
    io?: number;
    latency?: number;
    error_rate?: number;
    status?: string;
    last_updated?: string;
  };
  onClick?: () => void;
}

interface DetailPanelProps {
  resource: ResourceTileProps;
  onClose: () => void;
}

function getHealthColor(health: string): { bg: string; border: string; text: string } {
  switch (health) {
    case 'critical':
      return { bg: 'bg-red-500/10', border: 'border-red-500/50', text: 'text-red-600 dark:text-red-400' };
    case 'warning':
      return { bg: 'bg-amber-500/10', border: 'border-amber-500/50', text: 'text-amber-600 dark:text-amber-400' };
    default:
      return { bg: 'bg-green-500/10', border: 'border-green-500/50', text: 'text-green-600 dark:text-green-400' };
  }
}

function getHealthBadge(health: string): string {
  switch (health) {
    case 'critical':
      return 'bg-red-500/20 text-red-700 dark:text-red-300 border-red-500/40';
    case 'warning':
      return 'bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-500/40';
    default:
      return 'bg-green-500/20 text-green-700 dark:text-green-300 border-green-500/40';
  }
}

function DetailPanel({ resource, onClose }: DetailPanelProps) {
  const colors = getHealthColor(resource.health);
  
  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto border border-slate-200 dark:border-slate-700">
        <div className="sticky top-0 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 p-4 flex justify-between items-start">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className={`text-[10px] px-2 py-0.5 rounded border font-medium uppercase ${getHealthBadge(resource.health)}`}>
                {resource.health}
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400 uppercase">{resource.type}</span>
            </div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{resource.name}</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">{resource.id}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-slate-500 dark:text-slate-400" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Primary Metric */}
          <div className={`p-4 rounded-lg border ${colors.bg} ${colors.border}`}>
            <p className="text-xs text-slate-600 dark:text-slate-400 mb-1">{resource.primaryMetric.label}</p>
            <p className={`text-3xl font-bold ${colors.text}`}>
              {resource.primaryMetric.value}{resource.primaryMetric.unit}
            </p>
          </div>

          {/* Detailed Metrics */}
          {resource.metrics && (
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">Detailed Metrics</h3>
              <div className="grid grid-cols-2 gap-3">
                {resource.metrics.cpu !== undefined && (
                  <MetricCard label="CPU" value={resource.metrics.cpu} unit="%" />
                )}
                {resource.metrics.memory !== undefined && (
                  <MetricCard label="Memory" value={resource.metrics.memory} unit="%" />
                )}
                {resource.metrics.storage !== undefined && (
                  <MetricCard label="Storage" value={resource.metrics.storage} unit="%" />
                )}
                {resource.metrics.network !== undefined && (
                  <MetricCard label="Network" value={resource.metrics.network} unit="%" />
                )}
                {resource.metrics.io !== undefined && (
                  <MetricCard label="I/O" value={resource.metrics.io} unit="%" />
                )}
                {resource.metrics.latency !== undefined && (
                  <MetricCard label="Latency" value={resource.metrics.latency} unit="ms" />
                )}
                {resource.metrics.error_rate !== undefined && (
                  <MetricCard label="Error Rate" value={resource.metrics.error_rate} unit="%" />
                )}
              </div>
            </div>
          )}

          {/* Status & Metadata */}
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">Status Information</h3>
            <div className="space-y-2 text-sm">
              {resource.metrics?.status && (
                <div className="flex justify-between">
                  <span className="text-slate-600 dark:text-slate-400">Status</span>
                  <span className="text-slate-900 dark:text-white font-medium">{resource.metrics.status}</span>
                </div>
              )}
              {resource.metrics?.last_updated && (
                <div className="flex justify-between">
                  <span className="text-slate-600 dark:text-slate-400">Last Updated</span>
                  <span className="text-slate-900 dark:text-white font-mono text-xs">{resource.metrics.last_updated}</span>
                </div>
              )}
            </div>
          </div>

          {/* AI Insights Placeholder */}
          <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-blue-900 dark:text-blue-300 mb-2">AI Insights</h3>
            <p className="text-xs text-blue-700 dark:text-blue-400">
              {resource.health === 'critical' 
                ? `⚠️ Critical resource detected. Consider scaling or investigating recent changes.`
                : resource.health === 'warning'
                ? `⚡ Resource showing elevated metrics. Monitor for potential issues.`
                : `✓ Resource operating within normal parameters.`}
            </p>
          </div>

          {/* Related Incidents Placeholder */}
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-2">Recent Incidents</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 italic">
              No recent incidents related to this resource
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ label, value, unit }: { label: string; value: number; unit: string }) {
  const getColor = () => {
    if (value >= 80) return 'text-red-600 dark:text-red-400';
    if (value >= 60) return 'text-amber-600 dark:text-amber-400';
    return 'text-green-600 dark:text-green-400';
  };

  return (
    <div className="p-3 bg-slate-50 dark:bg-slate-900/50 rounded-lg border border-slate-200 dark:border-slate-700">
      <p className="text-xs text-slate-600 dark:text-slate-400 mb-1">{label}</p>
      <p className={`text-lg font-bold ${getColor()}`}>
        {value.toFixed(1)}{unit}
      </p>
    </div>
  );
}

export function ResourceTile({ id, name, primaryMetric, health, metrics, onClick }: ResourceTileProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  const colors = getHealthColor(health);

  return (
    <div className="relative">
      <button
        onClick={onClick}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        className={`w-full p-3 rounded-lg border ${colors.border} ${colors.bg} hover:shadow-lg transition-all duration-200 text-left group`}
      >
        {/* Resource Name */}
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold text-slate-900 dark:text-white truncate pr-2 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
            {name}
          </p>
          <span className={`text-[9px] px-1.5 py-0.5 rounded border font-medium uppercase ${getHealthBadge(health)}`}>
            {health === 'healthy' ? '✓' : health === 'warning' ? '!' : '✕'}
          </span>
        </div>

        {/* Primary Metric */}
        <div className="mb-1">
          <p className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wide">
            {primaryMetric.label}
          </p>
          <p className={`text-lg font-bold ${colors.text}`}>
            {primaryMetric.value}{primaryMetric.unit}
          </p>
        </div>

        {/* Secondary Metrics (compact) */}
        {metrics && (
          <div className="grid grid-cols-2 gap-1 text-[9px] text-slate-600 dark:text-slate-400 mt-2 pt-2 border-t border-slate-200 dark:border-slate-700">
            {metrics.cpu !== undefined && <span>CPU {metrics.cpu.toFixed(0)}%</span>}
            {metrics.memory !== undefined && <span>Mem {metrics.memory.toFixed(0)}%</span>}
            {metrics.latency !== undefined && <span>Lat {metrics.latency.toFixed(0)}ms</span>}
            {metrics.error_rate !== undefined && <span>Err {metrics.error_rate.toFixed(1)}%</span>}
          </div>
        )}
      </button>

      {/* Hover Tooltip */}
      {showTooltip && (
        <div className="absolute z-10 bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-3 bg-slate-900 dark:bg-slate-950 text-white rounded-lg shadow-xl border border-slate-700 pointer-events-none">
          <div className="text-xs space-y-1">
            <p className="font-semibold text-white mb-2">{name}</p>
            <p className="text-slate-400 font-mono text-[10px] mb-2">{id}</p>
            {metrics && (
              <>
                {metrics.cpu !== undefined && (
                  <div className="flex justify-between">
                    <span className="text-slate-400">CPU:</span>
                    <span className="font-mono">{metrics.cpu.toFixed(1)}%</span>
                  </div>
                )}
                {metrics.memory !== undefined && (
                  <div className="flex justify-between">
                    <span className="text-slate-400">Memory:</span>
                    <span className="font-mono">{metrics.memory.toFixed(1)}%</span>
                  </div>
                )}
                {metrics.storage !== undefined && (
                  <div className="flex justify-between">
                    <span className="text-slate-400">Storage:</span>
                    <span className="font-mono">{metrics.storage.toFixed(1)}%</span>
                  </div>
                )}
                {metrics.latency !== undefined && (
                  <div className="flex justify-between">
                    <span className="text-slate-400">Latency:</span>
                    <span className="font-mono">{metrics.latency.toFixed(1)}ms</span>
                  </div>
                )}
                {metrics.error_rate !== undefined && (
                  <div className="flex justify-between">
                    <span className="text-slate-400">Error Rate:</span>
                    <span className="font-mono">{metrics.error_rate.toFixed(2)}%</span>
                  </div>
                )}
                {metrics.status && (
                  <div className="flex justify-between pt-1 border-t border-slate-700">
                    <span className="text-slate-400">Status:</span>
                    <span className="font-medium">{metrics.status}</span>
                  </div>
                )}
              </>
            )}
          </div>
          <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 w-2 h-2 bg-slate-900 dark:bg-slate-950 border-l border-b border-slate-700 rotate-45" />
        </div>
      )}
    </div>
  );
}

export function ResourceHeatmap({ 
  title, 
  resources, 
  columns = 5 
}: { 
  title: string; 
  resources: ResourceTileProps[]; 
  columns?: number;
}) {
  const [selectedResource, setSelectedResource] = useState<ResourceTileProps | null>(null);

  return (
    <div>
      <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">{title}</h3>
      <div 
        className="grid gap-2"
        style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${columns === 5 ? '180px' : '220px'}, 1fr))` }}
      >
        {resources.map((resource) => (
          <ResourceTile
            key={resource.id}
            {...resource}
            onClick={() => setSelectedResource(resource)}
          />
        ))}
      </div>

      {selectedResource && (
        <DetailPanel
          resource={selectedResource}
          onClose={() => setSelectedResource(null)}
        />
      )}
    </div>
  );
}

// Made with Bob
