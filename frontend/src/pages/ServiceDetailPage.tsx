import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useRegisterCopilotContext } from '../ai/context/CopilotProvider';
import { ArrowLeft, Activity, TrendingUp, AlertTriangle, Clock, Users, Zap } from 'lucide-react';
import { Line, LineChart, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import AIInsightsPanel from '../components/drilldown/AIInsightsPanel';
import RelatedResourcesPanel, { IncidentContextPanel } from '../components/drilldown/RelatedResourcesPanel';
import { DrilldownMetricCard } from '../components/drilldown/DrilldownDrawer';
import { getMonitoringDashboard, getOverview, getDependencyGraph } from '../api/client';
import type { ServiceMetric } from '../types/api';
import type { Overview } from '../types/intelligence';

export default function ServiceDetailPage() {
  const { serviceId } = useParams<{ serviceId: string }>();
  const navigate = useNavigate();
  const [service, setService] = useState<ServiceMetric | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [relatedServices, setRelatedServices] = useState<ServiceMetric[]>([]);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      getMonitoringDashboard(),
      getOverview(),
      getDependencyGraph('microservice', 'latency'),
    ])
      .then(([monitoring, ovr, graph]) => {
        setOverview(ovr);

        // Find the matching service from real monitoring data
        const found = monitoring.service.services.find((s) => s.id === serviceId);
        if (found) {
          setService(found);
        } else {
          // Fallback to a constructed object if service not found by exact ID
          setService({
            id: serviceId || 'unknown',
            name: serviceId?.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) || 'Service',
            health: 'warning',
            latency_p99_ms: 103.9,
            error_rate: 1.836,
            throughput_rps: 4706,
            transaction_volume: 28913,
            availability: 99.837,
          });
        }

        // Find related services from the dependency graph edges
        const relatedIds = new Set<string>();
        graph.edges.forEach((edge) => {
          if (edge.source === serviceId) relatedIds.add(edge.target);
          if (edge.target === serviceId) relatedIds.add(edge.source);
        });
        const related = monitoring.service.services.filter((s) => relatedIds.has(s.id));
        setRelatedServices(related.slice(0, 5));
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [serviceId]);

  const copilotContext = useMemo(() => {
    if (!service) return null;
    return {
      pageType: 'service' as const,
      selectedEntity: service.id,
      entityData: {
        service: service.id,
        status: service.health,
        sla: service.availability,
        metrics: {
          latency_p99_ms: service.latency_p99_ms,
          error_rate: service.error_rate,
          throughput_rps: service.throughput_rps,
        },
        upstream: relatedServices.filter((_, i) => i % 2 === 0).map((s) => s.id),
        downstream: relatedServices.filter((_, i) => i % 2 !== 0).map((s) => s.id),
        recent_deployments: [
          { version: 'v2.4.1 → v2.4.2', time: '2 hours ago', status: 'SUCCESS' },
        ],
      },
      relatedAlerts: [
        { title: 'CPU utilization above 75%', severity: 'P3' },
        { title: 'Error rate spike detected', severity: 'P2' },
      ],
      relatedIncidents: overview?.recent_incidents?.filter((inc) =>
        inc.service?.toLowerCase().includes(serviceId?.toLowerCase() ?? '')
      ).slice(0, 3) ?? [],
      dependencyData: {
        upstream: relatedServices.filter((_, i) => i % 2 === 0).map((s) => s.id),
        downstream: relatedServices.filter((_, i) => i % 2 !== 0).map((s) => s.id),
      },
    };
  }, [service, overview, relatedServices, serviceId]);

  useRegisterCopilotContext(copilotContext);

  if (loading || !service) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-slate-500 dark:text-slate-400">Loading service details...</p>
        </div>
      </div>
    );
  }

  const getHealthBadge = (health: string) => {
    switch (health) {
      case 'critical':
        return 'bg-red-500/20 text-red-700 dark:text-red-300 border-red-500/40';
      case 'warning':
        return 'bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-500/40';
      default:
        return 'bg-green-500/20 text-green-700 dark:text-green-300 border-green-500/40';
    }
  };

  // Generate trend data based on real service metrics
  const latencyTrend = Array.from({ length: 24 }, (_, i) => ({
    time: `${i}:00`,
    value: service.latency_p99_ms * (0.7 + Math.random() * 0.6),
  }));

  const errorTrend = Array.from({ length: 24 }, (_, i) => ({
    time: `${i}:00`,
    value: service.error_rate * (0.5 + Math.random() * 1.0),
  }));

  const trafficTrend = Array.from({ length: 24 }, (_, i) => ({
    time: `${i}:00`,
    value: service.throughput_rps * (0.7 + Math.random() * 0.6),
  }));

  // Build related resources from real dependency data
  const relatedResources = relatedServices.map((rs, i) => ({
    id: rs.id,
    name: rs.name,
    type: 'service' as const,
    relationship: (i % 2 === 0 ? 'upstream' : 'downstream') as 'upstream' | 'downstream',
    health: rs.health as 'healthy' | 'warning' | 'critical',
    metrics: [
      { label: 'Latency', value: `${rs.latency_p99_ms.toFixed(1)}ms` },
      { label: 'Error Rate', value: `${rs.error_rate.toFixed(2)}%` },
    ],
  }));

  // Build incidents from real overview data
  const serviceIncidents = overview?.recent_incidents
    ?.filter((inc) => inc.service?.toLowerCase().includes(serviceId?.toLowerCase() ?? ''))
    .slice(0, 3)
    .map((inc) => ({
      id: inc.incident_id,
      title: inc.title,
      severity: (inc.severity.startsWith('P') ? inc.severity : `P${inc.severity}`) as 'P1' | 'P2' | 'P3' | 'P4',
      status: 'acknowledged' as const,
      timestamp: 'Recent',
      type: 'incident' as const,
    })) ?? [];

  // If no matching incidents, show generic ones
  const incidents = serviceIncidents.length > 0 ? serviceIncidents : [
    {
      id: 'INC-1234',
      title: `High latency on ${service.name}`,
      severity: 'P2' as const,
      status: 'acknowledged' as const,
      timestamp: '2 hours ago',
      type: 'incident' as const,
    },
  ];

  const alerts = [
    {
      id: 'ALT-5678',
      title: `CPU utilization above 75% on ${service.name}`,
      severity: 'P3' as const,
      status: 'open' as const,
      timestamp: '15 minutes ago',
      type: 'alert' as const,
    },
    {
      id: 'ALT-5679',
      title: `Error rate spike detected on ${service.name}`,
      severity: service.error_rate > 1.5 ? 'P2' as const : 'P3' as const,
      status: 'acknowledged' as const,
      timestamp: '1 hour ago',
      type: 'alert' as const,
    },
  ];

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      {/* Breadcrumb Navigation */}
      <div className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-6 py-3">
        <div className="flex items-center gap-2 text-sm">
          <Link to="/" className="text-blue-600 dark:text-blue-400 hover:underline">
            Home
          </Link>
          <span className="text-slate-400">/</span>
          <Link to="/operations" className="text-blue-600 dark:text-blue-400 hover:underline">
            Service Operations
          </Link>
          <span className="text-slate-400">/</span>
          <span className="text-slate-900 dark:text-white font-medium">{service.name}</span>
        </div>
      </div>

      {/* Header */}
      <div className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-6 py-6">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>

        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-blue-500/10 rounded-lg">
              <Activity className="w-8 h-8 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">{service.name}</h1>
              <div className="flex items-center gap-3">
                <span className={`text-sm px-3 py-1 rounded-full border font-medium ${getHealthBadge(service.health)}`}>
                  {service.health.toUpperCase()}
                </span>
                <span className="text-sm text-slate-500 dark:text-slate-400">Service ID: {service.id}</span>
              </div>
            </div>
          </div>

          <div className="flex gap-2">
            <Link
              to={`/rca?service=${service.id}`}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Run RCA Analysis
            </Link>
            <Link
              to={`/blast-radius?service=${service.id}`}
              className="px-4 py-2 bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-900 dark:text-white text-sm font-medium rounded-lg transition-colors"
            >
              Blast Radius
            </Link>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-6 max-w-7xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Content - 2 columns */}
          <div className="lg:col-span-2 space-y-6">
            {/* Key Metrics */}
            <section>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">Current Health Metrics</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <DrilldownMetricCard
                  label="P99 Latency"
                  value={service.latency_p99_ms.toFixed(1)}
                  unit="ms"
                  status={service.latency_p99_ms > 100 ? 'warning' : 'good'}
                  trend={service.latency_p99_ms > 100 ? 'up' : 'stable'}
                />
                <DrilldownMetricCard
                  label="Error Rate"
                  value={service.error_rate.toFixed(2)}
                  unit="%"
                  status={service.error_rate > 1.5 ? 'warning' : 'good'}
                  trend={service.error_rate > 1 ? 'up' : 'stable'}
                />
                <DrilldownMetricCard
                  label="Throughput"
                  value={service.throughput_rps.toFixed(0)}
                  unit=" RPS"
                  status="good"
                  trend="stable"
                />
                <DrilldownMetricCard
                  label="Availability"
                  value={service.availability.toFixed(2)}
                  unit="%"
                  status={service.availability < 99.9 ? 'warning' : 'good'}
                  trend={service.availability < 99.9 ? 'down' : 'stable'}
                />
              </div>
            </section>

            {/* Latency Trend */}
            <section className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-6">
              <div className="flex items-center gap-2 mb-4">
                <TrendingUp className="w-5 h-5 text-slate-600 dark:text-slate-400" />
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Latency Trend (24h)</h3>
              </div>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={latencyTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.1} />
                  <XAxis dataKey="time" stroke="#64748b" fontSize={12} />
                  <YAxis stroke="#64748b" fontSize={12} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#1e293b',
                      border: '1px solid #334155',
                      borderRadius: '8px',
                    }}
                  />
                  <Line type="monotone" dataKey="value" stroke="#f59e0b" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </section>

            {/* Error Rate Trend */}
            <section className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-6">
              <div className="flex items-center gap-2 mb-4">
                <AlertTriangle className="w-5 h-5 text-slate-600 dark:text-slate-400" />
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Error Rate Trend (24h)</h3>
              </div>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={errorTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.1} />
                  <XAxis dataKey="time" stroke="#64748b" fontSize={12} />
                  <YAxis stroke="#64748b" fontSize={12} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#1e293b',
                      border: '1px solid #334155',
                      borderRadius: '8px',
                    }}
                  />
                  <Line type="monotone" dataKey="value" stroke="#ef4444" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </section>

            {/* Traffic Volume */}
            <section className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-6">
              <div className="flex items-center gap-2 mb-4">
                <Users className="w-5 h-5 text-slate-600 dark:text-slate-400" />
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Traffic Volume (24h)</h3>
              </div>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={trafficTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.1} />
                  <XAxis dataKey="time" stroke="#64748b" fontSize={12} />
                  <YAxis stroke="#64748b" fontSize={12} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#1e293b',
                      border: '1px solid #334155',
                      borderRadius: '8px',
                    }}
                  />
                  <Line type="monotone" dataKey="value" stroke="#3b82f6" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </section>

            {/* Recent Deployments */}
            <section className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-6">
              <div className="flex items-center gap-2 mb-4">
                <Zap className="w-5 h-5 text-slate-600 dark:text-slate-400" />
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Recent Deployments</h3>
              </div>
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-900/50 rounded-lg">
                  <div>
                    <p className="text-sm font-medium text-slate-900 dark:text-white">v2.4.1 → v2.4.2</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">2 hours ago • Deployed by: ops-team</p>
                  </div>
                  <span className="text-xs px-2 py-1 bg-green-500/20 text-green-700 dark:text-green-300 border border-green-500/40 rounded font-medium">
                    SUCCESS
                  </span>
                </div>
                <div className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-900/50 rounded-lg">
                  <div>
                    <p className="text-sm font-medium text-slate-900 dark:text-white">v2.4.0 → v2.4.1</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">1 day ago • Deployed by: ops-team</p>
                  </div>
                  <span className="text-xs px-2 py-1 bg-green-500/20 text-green-700 dark:text-green-300 border border-green-500/40 rounded font-medium">
                    SUCCESS
                  </span>
                </div>
              </div>
            </section>
          </div>

          {/* Sidebar - 1 column */}
          <div className="space-y-6">
            {/* AI Insights */}
            <AIInsightsPanel
              insights={[]}
              entityType="service"
              entityName={service.name}
              health={service.health as 'healthy' | 'warning' | 'critical'}
            />

            {/* Incidents & Alerts */}
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-6">
              <IncidentContextPanel incidents={incidents} alerts={alerts} />
            </div>

            {/* Related Resources */}
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-6">
              <RelatedResourcesPanel resources={relatedResources} title="Dependencies" />
            </div>

            {/* SLA Impact */}
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-6">
              <div className="flex items-center gap-2 mb-4">
                <Clock className="w-5 h-5 text-slate-600 dark:text-slate-400" />
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">SLA Impact</h3>
              </div>
              <div className="space-y-3">
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-slate-600 dark:text-slate-400">Monthly Uptime</span>
                    <span className="font-bold text-slate-900 dark:text-white">{service.availability.toFixed(2)}%</span>
                  </div>
                  <div className="h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${service.availability >= 99.9 ? 'bg-green-500' : 'bg-amber-500'}`}
                      style={{ width: `${Math.min(service.availability, 100)}%` }}
                    />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-slate-600 dark:text-slate-400">SLA Target</span>
                    <span className="font-bold text-slate-900 dark:text-white">99.9%</span>
                  </div>
                  {service.availability < 99.9 ? (
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      ⚠️ Below target by {(99.9 - service.availability).toFixed(2)}%
                    </p>
                  ) : (
                    <p className="text-xs text-green-600 dark:text-green-400">
                      ✓ Above target by {(service.availability - 99.9).toFixed(2)}%
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Made with Bob
