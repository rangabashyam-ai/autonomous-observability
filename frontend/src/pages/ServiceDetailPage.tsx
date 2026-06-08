import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useRegisterCopilotContext } from '../ai/context/CopilotProvider';
import { ArrowLeft, Activity, TrendingUp, AlertTriangle, Clock, Users, Zap } from 'lucide-react';
import { Line, LineChart, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import AIInsightsPanel from '../components/drilldown/AIInsightsPanel';
import RelatedResourcesPanel, { IncidentContextPanel } from '../components/drilldown/RelatedResourcesPanel';
import { DrilldownMetricCard } from '../components/drilldown/DrilldownDrawer';

export default function ServiceDetailPage() {
  const { serviceId } = useParams<{ serviceId: string }>();
  const navigate = useNavigate();
  const [service, setService] = useState<any>(null);

  useEffect(() => {
    // Mock service data - in production, fetch from API
    setService({
      id: serviceId,
      name: serviceId?.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) || 'Service',
      health: 'warning',
      latency_p99_ms: 103.9,
      error_rate: 1.836,
      throughput_rps: 4706,
      availability: 99.837,
      transaction_volume: 28913,
    });
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
        upstream: ['auth-service'],
        downstream: ['postgres-cluster', 'kafka-cluster'],
        recent_deployments: [
          { version: 'v2.4.1 → v2.4.2', time: '2 hours ago', status: 'SUCCESS' },
        ],
      },
      relatedAlerts: [
        { title: 'CPU utilization above 75%', severity: 'P3' },
        { title: 'Error rate spike detected', severity: 'P2' },
      ],
      relatedIncidents: [
        { id: 'INC-1234', title: 'High latency on payment authorization', severity: 'P2' },
      ],
      dependencyData: {
        upstream: ['auth-service'],
        downstream: ['postgres-cluster', 'kafka-cluster'],
      },
    };
  }, [service]);

  useRegisterCopilotContext(copilotContext);

  if (!service) {
    return <div className="p-6">Loading...</div>;
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

  // Mock trend data
  const latencyTrend = Array.from({ length: 24 }, (_, i) => ({
    time: `${i}:00`,
    value: 80 + Math.random() * 40,
  }));

  const errorTrend = Array.from({ length: 24 }, (_, i) => ({
    time: `${i}:00`,
    value: 1 + Math.random() * 2,
  }));

  const trafficTrend = Array.from({ length: 24 }, (_, i) => ({
    time: `${i}:00`,
    value: 4000 + Math.random() * 1500,
  }));

  // Mock related resources
  const relatedResources = [
    {
      id: 'postgres-cluster',
      name: 'PostgreSQL Cluster',
      type: 'database' as const,
      relationship: 'downstream' as const,
      health: 'warning' as const,
      metrics: [
        { label: 'Connections', value: '245/300' },
        { label: 'Query Latency', value: '45ms' },
      ],
    },
    {
      id: 'auth-service',
      name: 'Auth Service',
      type: 'service' as const,
      relationship: 'upstream' as const,
      health: 'healthy' as const,
      metrics: [
        { label: 'Latency', value: '12ms' },
        { label: 'Error Rate', value: '0.2%' },
      ],
    },
    {
      id: 'kafka-cluster',
      name: 'Kafka Cluster',
      type: 'infrastructure' as const,
      relationship: 'downstream' as const,
      health: 'healthy' as const,
      metrics: [
        { label: 'Throughput', value: '2.5K msg/s' },
        { label: 'Lag', value: '120ms' },
      ],
    },
  ];

  // Mock incidents and alerts
  const incidents = [
    {
      id: 'INC-1234',
      title: 'High latency on payment authorization',
      severity: 'P2' as const,
      status: 'acknowledged' as const,
      timestamp: '2 hours ago',
      type: 'incident' as const,
    },
  ];

  const alerts = [
    {
      id: 'ALT-5678',
      title: 'CPU utilization above 75%',
      severity: 'P3' as const,
      status: 'open' as const,
      timestamp: '15 minutes ago',
      type: 'alert' as const,
    },
    {
      id: 'ALT-5679',
      title: 'Error rate spike detected',
      severity: 'P2' as const,
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
                  value={service.latency_p99_ms}
                  unit="ms"
                  status={service.latency_p99_ms > 100 ? 'warning' : 'good'}
                  trend="up"
                />
                <DrilldownMetricCard
                  label="Error Rate"
                  value={service.error_rate}
                  unit="%"
                  status={service.error_rate > 1.5 ? 'warning' : 'good'}
                  trend="up"
                />
                <DrilldownMetricCard
                  label="Throughput"
                  value={service.throughput_rps}
                  unit=" RPS"
                  status="good"
                  trend="stable"
                />
                <DrilldownMetricCard
                  label="Availability"
                  value={service.availability}
                  unit="%"
                  status={service.availability < 99.9 ? 'warning' : 'good'}
                  trend="down"
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
              health={service.health}
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
                    <span className="font-bold text-slate-900 dark:text-white">99.87%</span>
                  </div>
                  <div className="h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                    <div className="h-full bg-green-500 rounded-full" style={{ width: '99.87%' }} />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-slate-600 dark:text-slate-400">SLA Target</span>
                    <span className="font-bold text-slate-900 dark:text-white">99.9%</span>
                  </div>
                  <p className="text-xs text-amber-600 dark:text-amber-400">⚠️ Below target by 0.03%</p>
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
