import { Link } from 'react-router-dom';
import { Network, Database, Server, Activity, ExternalLink } from 'lucide-react';

interface RelatedResource {
  id: string;
  name: string;
  type: 'service' | 'database' | 'infrastructure' | 'api';
  relationship: 'upstream' | 'downstream' | 'peer';
  health: 'healthy' | 'warning' | 'critical';
  metrics?: {
    label: string;
    value: string;
  }[];
}

interface RelatedResourcesPanelProps {
  resources: RelatedResource[];
  title?: string;
}

function getResourceIcon(type: string) {
  switch (type) {
    case 'service':
      return <Activity className="w-4 h-4" />;
    case 'database':
      return <Database className="w-4 h-4" />;
    case 'infrastructure':
      return <Server className="w-4 h-4" />;
    case 'api':
      return <Network className="w-4 h-4" />;
    default:
      return <Activity className="w-4 h-4" />;
  }
}

function getHealthColor(health: string) {
  switch (health) {
    case 'critical':
      return 'bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-300';
    case 'warning':
      return 'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300';
    default:
      return 'bg-green-500/10 border-green-500/30 text-green-700 dark:text-green-300';
  }
}

function getRelationshipBadge(relationship: string) {
  const styles = {
    upstream: 'bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/30',
    downstream: 'bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-500/30',
    peer: 'bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/30',
  };

  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium uppercase ${styles[relationship as keyof typeof styles]}`}>
      {relationship}
    </span>
  );
}

export default function RelatedResourcesPanel({ resources, title = 'Related Resources' }: RelatedResourcesPanelProps) {
  if (resources.length === 0) {
    return (
      <div className="text-center py-8 text-slate-500 dark:text-slate-400 text-sm">
        No related resources found
      </div>
    );
  }

  return (
    <div>
      <h4 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">{title}</h4>
      <div className="space-y-2">
        {resources.map((resource) => (
          <Link
            key={resource.id}
            to={`/${resource.type}s/${resource.id}`}
            className={`block p-3 rounded-lg border transition-all hover:shadow-md ${getHealthColor(resource.health)}`}
          >
            <div className="flex items-start justify-between mb-2">
              <div className="flex items-center gap-2">
                <div className="text-slate-600 dark:text-slate-400">
                  {getResourceIcon(resource.type)}
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-900 dark:text-white">{resource.name}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{resource.id}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {getRelationshipBadge(resource.relationship)}
                <ExternalLink className="w-3 h-3 text-slate-400" />
              </div>
            </div>

            {resource.metrics && resource.metrics.length > 0 && (
              <div className="flex gap-3 text-xs">
                {resource.metrics.map((metric, idx) => (
                  <div key={idx}>
                    <span className="text-slate-600 dark:text-slate-400">{metric.label}: </span>
                    <span className="font-mono text-slate-900 dark:text-white">{metric.value}</span>
                  </div>
                ))}
              </div>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}

interface IncidentAlert {
  id: string;
  title: string;
  severity: 'P1' | 'P2' | 'P3' | 'P4';
  status: 'open' | 'acknowledged' | 'resolved';
  timestamp: string;
  type: 'incident' | 'alert';
}

interface IncidentContextPanelProps {
  incidents: IncidentAlert[];
  alerts: IncidentAlert[];
}

export function IncidentContextPanel({ incidents, alerts }: IncidentContextPanelProps) {
  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'P1':
        return 'bg-red-500/20 text-red-700 dark:text-red-300 border-red-500/40';
      case 'P2':
        return 'bg-orange-500/20 text-orange-700 dark:text-orange-300 border-orange-500/40';
      case 'P3':
        return 'bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-500/40';
      default:
        return 'bg-blue-500/20 text-blue-700 dark:text-blue-300 border-blue-500/40';
    }
  };

  const getStatusBadge = (status: string) => {
    const styles = {
      open: 'bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/30',
      acknowledged: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30',
      resolved: 'bg-green-500/10 text-green-700 dark:text-green-300 border-green-500/30',
    };

    return (
      <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium uppercase ${styles[status as keyof typeof styles]}`}>
        {status}
      </span>
    );
  };

  return (
    <div className="space-y-4">
      {/* Active Incidents */}
      {incidents.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">Related Incidents</h4>
          <div className="space-y-2">
            {incidents.map((incident) => (
              <Link
                key={incident.id}
                to={`/incidents?id=${incident.id}`}
                className="block p-3 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-lg hover:shadow-md transition-all"
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-0.5 rounded border font-medium ${getSeverityColor(incident.severity)}`}>
                      {incident.severity}
                    </span>
                    {getStatusBadge(incident.status)}
                  </div>
                  <ExternalLink className="w-3 h-3 text-slate-400" />
                </div>
                <p className="text-sm font-medium text-slate-900 dark:text-white mb-1">{incident.title}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">{incident.id} • {incident.timestamp}</p>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Active Alerts */}
      {alerts.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">Active Alerts</h4>
          <div className="space-y-2">
            {alerts.map((alert) => (
              <div
                key={alert.id}
                className="p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg"
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-0.5 rounded border font-medium ${getSeverityColor(alert.severity)}`}>
                      {alert.severity}
                    </span>
                    {getStatusBadge(alert.status)}
                  </div>
                </div>
                <p className="text-sm font-medium text-slate-900 dark:text-white mb-1">{alert.title}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">{alert.timestamp}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {incidents.length === 0 && alerts.length === 0 && (
        <div className="text-center py-8 text-slate-500 dark:text-slate-400 text-sm">
          No active incidents or alerts
        </div>
      )}
    </div>
  );
}

// Made with Bob
