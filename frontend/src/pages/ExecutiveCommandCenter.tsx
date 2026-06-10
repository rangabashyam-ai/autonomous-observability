import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getMonitoringDashboard, getOverview } from '../api/client';
import { useRegisterCopilotContext } from '../ai/context/CopilotProvider';
import type { Overview } from '../types/intelligence';
import type { MonitoringDashboard } from '../types/api';
import { PageHeader, Grid12, CollapsibleSection } from '../components/ui/layout-primitives';
import { MetricCard } from '../components/ui/metric-card';
import { Card, CardHeader, CardTitle } from '../components/ui/card';
import { Badge, HealthBadge } from '../components/ui/badge';
import { generateDualTrend, generateTrend, TrendChart, MiniAreaChart } from '../components/charts/charts';
import { RegionalHealthMap, UtilizationBar } from '../components/dashboard/visualizations';
import { Sparkles, Activity, ShieldAlert, TrendingUp, Users, Zap, ExternalLink } from 'lucide-react';
import DrilldownDrawer, { DrilldownSection, DrilldownMetricCard, DrilldownButton } from '../components/drilldown/DrilldownDrawer';
import InlineCopilot from '../components/copilot/InlineCopilot';

export default function ExecutiveCommandCenter() {
  const navigate = useNavigate();
  const [monitoring, setMonitoring] = useState<MonitoringDashboard | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [activeDrawer, setActiveDrawer] = useState<'health' | 'revenue' | 'incidents' | 'sla' | 'customers' | null>(null);
  const [selectedRegion, setSelectedRegion] = useState<{ id: string; label: string; x: number; y: number; health: 'healthy' | 'warning' | 'critical' } | null>(null);

  useEffect(() => {
    Promise.all([getMonitoringDashboard(), getOverview()])
      .then(([m, o]) => {
        setMonitoring(m);
        setOverview(o);
      })
      .catch(console.error);
  }, []);

  const exec = monitoring?.executive;
  const services = monitoring?.service.services ?? [];

  const businessHealth = useMemo(() => {
    if (!exec) return 0;
    return Math.round(
      (exec.service_availability * 0.35 +
        exec.transaction_success_rate * 0.25 +
        exec.sla_compliance * 0.4) /
      100 *
      100
    );
  }, [exec]);

  const aiSummary = useMemo(() => {
    if (!exec || !overview) return '';
    const atRisk = exec.services_at_risk;
    const warnings = overview.summary.early_warnings;
    if (atRisk > 0 && warnings > 0) {
      return `Service performance is stable overall; ${atRisk} service${atRisk > 1 ? 's' : ''} at risk with ${warnings} early warning${warnings > 1 ? 's' : ''} active. Revenue exposure has decreased following recent DB migration.`;
    }
    if (atRisk > 0) {
      return `${atRisk} business-critical service${atRisk > 1 ? 's' : ''} require attention. SLA compliance remains within target at ${exec.sla_compliance.toFixed(1)}%.`;
    }
    return 'All business services operating within SLA targets. No critical revenue impact detected in the last 24 hours.';
  }, [exec, overview]);

  const revenueTrend = useMemo(
    () => generateTrend(exec?.revenue_impact_usd ?? 1000, 12, 0.15),
    [exec?.revenue_impact_usd]
  );
  const kpiTrend = useMemo(
    () => generateDualTrend(exec?.service_availability ?? 99, exec?.transaction_success_rate ?? 98),
    [exec?.service_availability, exec?.transaction_success_rate]
  );

  const copilotContext = useMemo(() => {
    if (!monitoring || !overview) return null;
    const execData = monitoring.executive;
    return {
      pageType: 'executive' as const,
      selectedEntity: 'Executive Command Center',
      entityData: {
        sla: `${execData?.sla_compliance?.toFixed(2)}%`,
        revenue_risk: `$${execData?.revenue_impact_usd?.toLocaleString()}`,
        services_at_risk: execData?.services_at_risk,
        active_incidents: execData?.active_incidents,
        customer_impact: execData?.customer_impact_count,
        service_health: services.map((s) => ({ id: s.id, name: s.name, health: s.health, availability: s.availability })),
      },
      relatedAlerts: overview.open_alerts_preview ?? [],
      relatedIncidents: overview.recent_incidents ?? [],
      relatedMetrics: {
        business_health: businessHealth,
        transaction_success_rate: execData?.transaction_success_rate,
        service_availability: execData?.service_availability,
      },
    };
  }, [monitoring, overview, services, businessHealth]);

  useRegisterCopilotContext(copilotContext);

  if (!monitoring || !overview) {
    return <p className="text-text-secondary text-sm">Loading executive command center...</p>;
  }

  return (
    <div>
      <PageHeader
        title="Executive Command Center"
        description="Business visibility across service health, revenue risk, and customer impact"
      />

      <Grid12 className="mb-4">
        <div className="col-span-12 sm:col-span-6 lg:col-span-3">
          <MetricCard
            label="Business Health Score"
            value={`${businessHealth}%`}
            variant={businessHealth >= 95 ? 'success' : businessHealth >= 85 ? 'warning' : 'critical'}
            sub="Composite SLA + availability"
            trend={1.2}
            onClick={() => setActiveDrawer('health')}
          />
        </div>
        <div className="col-span-12 sm:col-span-6 lg:col-span-3">
          <MetricCard
            label="Active Incidents"
            value={exec!.active_incidents}
            variant={exec!.active_incidents > 0 ? 'critical' : 'success'}
            sub={`${overview.summary.open_alerts} open alerts`}
            onClick={() => setActiveDrawer('incidents')}
          />
        </div>
        <div className="col-span-12 sm:col-span-6 lg:col-span-3">
          <MetricCard
            label="SLA Compliance"
            value={`${exec!.sla_compliance.toFixed(2)}%`}
            variant="success"
            sub="Rolling 30-day window"
            trend={0.08}
            onClick={() => setActiveDrawer('sla')}
          />
        </div>
        <div className="col-span-12 sm:col-span-6 lg:col-span-3">
          <MetricCard
            label="Customers Impacted"
            value={exec!.customer_impact_count.toLocaleString()}
            variant={exec!.customer_impact_count > 50 ? 'warning' : 'default'}
            sub="Across all active incidents"
            onClick={() => setActiveDrawer('customers')}
          />
        </div>
      </Grid12>

      <CollapsibleSection title="Executive Intelligence" description="AI summary and business impact trends">
        <Grid12>
          <div className="col-span-12 lg:col-span-6">
            <Card hover className="h-full">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" />
                  <CardTitle>AI Executive Summary</CardTitle>
                </div>
                <Badge variant="default">Live</Badge>
              </CardHeader>
              <p className="text-sm text-text-primary leading-relaxed">{aiSummary}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link to="/copilot" className="text-xs text-primary hover:underline">
                  Ask follow-up →
                </Link>
                <Link to="/incidents" className="text-xs text-text-secondary hover:text-text-primary">
                  View incidents →
                </Link>
              </div>
            </Card>
          </div>
          <div className="col-span-12 lg:col-span-6" id="business-impact-trends-section">
            <Card className="h-full">
              <CardHeader>
                <CardTitle>Business Impact Trends</CardTitle>
              </CardHeader>
              <TrendChart data={kpiTrend} height={140} color="#3B82F6" color2="#10B981" />
              <div className="flex gap-4 mt-2 text-[10px] text-text-secondary">
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-primary" /> Availability
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-success" /> Success Rate
                </span>
              </div>
            </Card>
          </div>
        </Grid12>
      </CollapsibleSection>

      <div id="global-operations-section">
        <CollapsibleSection
          title="Global Operations"
          description="Service status, regional health, and KPI trends"
          className="mt-6"
        >
          <Grid12>
            <div className="col-span-12 lg:col-span-4">
              <Card>
                <CardHeader>
                  <CardTitle>Global Service Status</CardTitle>
                  <Link to="/operations" className="text-xs text-primary hover:underline">
                    Details →
                  </Link>
                </CardHeader>
                <div className="space-y-1">
                  {services.slice(0, 6).map((svc) => (
                    <Link
                      key={svc.id}
                      to={`/services/${svc.id}`}
                      className="flex items-center justify-between gap-2 p-2 rounded-lg hover:bg-card-hover transition-all duration-200 cursor-pointer group"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-text-primary group-hover:text-primary transition-colors truncate">{svc.name}</p>
                        <UtilizationBar label="" value={svc.availability} max={100} />
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <HealthBadge health={svc.health} />
                        <ChevronRight className="h-3.5 w-3.5 text-text-secondary/50 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                    </Link>
                  ))}
                </div>
              </Card>
            </div>
            <div className="col-span-12 lg:col-span-4">
              <Card className="h-full">
                <CardHeader>
                  <CardTitle>Regional Health Map</CardTitle>
                </CardHeader>
                <RegionalHealthMap
                  className="h-[180px]"
                  onRegionClick={(r) => setSelectedRegion(r)}
                />
                <div className="flex gap-3 mt-3 text-[10px] text-text-secondary">
                  <span className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-success" /> Healthy
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-warning" /> Warning
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-critical" /> Critical
                  </span>
                </div>
              </Card>
            </div>
            <div className="col-span-12 lg:col-span-4">
              <Card>
                <CardHeader>
                  <CardTitle>Business KPI Trends</CardTitle>
                </CardHeader>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    {
                      label: 'Transaction Volume',
                      value: services.reduce((a, s) => a + s.transaction_volume, 0),
                      onClick: () => setActiveDrawer('health')
                    },
                    {
                      label: 'Success Rate',
                      value: `${exec!.transaction_success_rate.toFixed(1)}%`,
                      onClick: () => setActiveDrawer('health')
                    },
                    {
                      label: 'Services at Risk',
                      value: exec!.services_at_risk,
                      alert: true,
                      onClick: () => setActiveDrawer('health')
                    },
                    {
                      label: 'Early Warnings',
                      value: overview.summary.early_warnings,
                      alert: overview.summary.early_warnings > 0,
                      onClick: () => navigate('/early-detection')
                    },
                  ].map((kpi) => (
                    <div
                      key={kpi.label}
                      onClick={kpi.onClick}
                      className="rounded-lg border border-border bg-background p-3 transition-all duration-200 hover:bg-card-hover hover:border-primary/30 hover:shadow-sm cursor-pointer"
                    >
                      <p className="text-[10px] text-text-secondary">{kpi.label}</p>
                      <p className={`text-lg font-semibold mt-1 ${kpi.alert ? 'text-critical' : 'text-text-primary'}`}>
                        {typeof kpi.value === 'number' ? kpi.value.toLocaleString() : kpi.value}
                      </p>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          </Grid12>
        </CollapsibleSection>
      </div>

      {/* Drilldown Drawer for Executive Metrics */}
      <DrilldownDrawer
        isOpen={activeDrawer !== null}
        onClose={() => setActiveDrawer(null)}
        title={
          activeDrawer === 'health' ? 'Business Health Score' :
            activeDrawer === 'revenue' ? 'Revenue at Risk' :
              activeDrawer === 'incidents' ? 'Active Incidents' :
                activeDrawer === 'sla' ? 'SLA Compliance' :
                  activeDrawer === 'customers' ? 'Customers Impacted' : ''
        }
        subtitle={
          activeDrawer === 'health' ? 'Overall operational health score' :
            activeDrawer === 'revenue' ? 'Estimated financial exposure due to operational issues' :
              activeDrawer === 'incidents' ? 'Current operational incidents requiring mitigation' :
                activeDrawer === 'sla' ? 'Rolling 30-day compliance targets and trends' :
                  activeDrawer === 'customers' ? 'Estimated users affected by active incidents' : ''
        }
        type={
          activeDrawer === 'incidents' || activeDrawer === 'customers' ? 'incident' :
            activeDrawer === 'revenue' || activeDrawer === 'sla' ? 'api' : 'service'
        }
        health={
          activeDrawer === 'health' ? (businessHealth >= 95 ? 'healthy' : businessHealth >= 85 ? 'warning' : 'critical') :
            activeDrawer === 'revenue' ? (exec!.revenue_impact_usd > 10000 ? 'critical' : exec!.revenue_impact_usd > 1000 ? 'warning' : 'healthy') :
              activeDrawer === 'incidents' ? (exec!.active_incidents > 0 ? 'critical' : 'healthy') :
                activeDrawer === 'sla' ? (exec!.sla_compliance >= 99.5 ? 'healthy' : exec!.sla_compliance >= 98.5 ? 'warning' : 'critical') :
                  activeDrawer === 'customers' ? (exec!.customer_impact_count > 50 ? 'warning' : 'healthy') : undefined
        }
      >

        {activeDrawer === 'health' && (
          <div>
            <div className="grid grid-cols-2 gap-4 mb-6">
              <DrilldownMetricCard
                label="Service Availability"
                value={`${exec!.service_availability.toFixed(2)}%`}
                status={exec!.service_availability >= 99.9 ? 'good' : exec!.service_availability >= 99.0 ? 'warning' : 'critical'}
              />
              <DrilldownMetricCard
                label="Transaction Success Rate"
                value={`${exec!.transaction_success_rate.toFixed(2)}%`}
                status={exec!.transaction_success_rate >= 99.0 ? 'good' : 'warning'}
              />
              <DrilldownMetricCard
                label="SLA Compliance"
                value={`${exec!.sla_compliance.toFixed(2)}%`}
                status={exec!.sla_compliance >= 99.0 ? 'good' : 'warning'}
              />
              <DrilldownMetricCard
                label="Services at Risk"
                value={exec!.services_at_risk}
                status={exec!.services_at_risk === 0 ? 'good' : 'critical'}
                onClick={() => {
                  document.getElementById('health-degraded-section')?.scrollIntoView({ behavior: 'smooth' });
                }}
              />
            </div>

            <div id="health-degraded-section">
              <DrilldownSection title="Degraded Services" icon={<Activity className="w-4 h-4" />}>
                {services.filter(s => s.health !== 'healthy').length === 0 ? (
                  <p className="text-xs text-text-secondary">All services are currently healthy.</p>
                ) : (
                  <div className="space-y-3">
                    {services.filter(s => s.health !== 'healthy').map(s => (
                      <div key={s.id} className="flex items-center justify-between p-3 rounded-lg border border-border bg-background">
                        <div>
                          <p className="text-sm font-semibold text-text-primary">{s.name}</p>
                          <p className="text-[10px] text-text-secondary">Latency: {s.latency_p99_ms.toFixed(1)}ms · Error Rate: {s.error_rate.toFixed(2)}%</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <HealthBadge health={s.health} />
                          <Link to={`/services/${s.id}`} className="p-1 hover:bg-card-hover rounded font-semibold text-primary" title="View details">
                            <ExternalLink className="w-4 h-4" />
                          </Link>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </DrilldownSection>
            </div>

            <div className="mt-6">
              <InlineCopilot
                pageType="executive"
                selectedEntity="Business Health Score"
                entityData={{
                  business_health_score: businessHealth,
                  service_availability: exec!.service_availability,
                  transaction_success_rate: exec!.transaction_success_rate,
                  sla_compliance: exec!.sla_compliance,
                  services_at_risk: exec!.services_at_risk,
                  degraded_services: services.filter(s => s.health !== 'healthy').map(s => ({ id: s.id, name: s.name, health: s.health, latency: s.latency_p99_ms, error_rate: s.error_rate })),
                }}
                relatedMetrics={{
                  business_health: businessHealth,
                  transaction_success_rate: exec!.transaction_success_rate,
                  service_availability: exec!.service_availability,
                }}
                suggestedQuestions={[
                  "Why is the Business Health Score at this level?",
                  "Which service degradation is impacting availability the most?",
                  "How is the score calculated?"
                ]}
              />
            </div>
          </div>
        )}

        {activeDrawer === 'revenue' && (
          <div>
            <div className="grid grid-cols-2 gap-4 mb-6">
              <DrilldownMetricCard
                label="Estimated 24h Exposure"
                value={`$${exec!.revenue_impact_usd.toLocaleString()}`}
                status={exec!.revenue_impact_usd > 10000 ? 'critical' : exec!.revenue_impact_usd > 1000 ? 'warning' : 'good'}
              />
              <DrilldownMetricCard
                label="Services Contributing"
                value={services.filter(s => s.health !== 'healthy').length}
                status={services.filter(s => s.health !== 'healthy').length > 0 ? 'warning' : 'good'}
                onClick={() => {
                  document.getElementById('revenue-breakdown-section')?.scrollIntoView({ behavior: 'smooth' });
                }}
              />
            </div>

            <div id="revenue-breakdown-section">
              <DrilldownSection title="Estimated Revenue Risk Breakdown" icon={<Zap className="w-4 h-4" />}>
                {services.filter(s => s.health !== 'healthy').length === 0 ? (
                  <p className="text-xs text-text-secondary">No active service risks impacting revenue.</p>
                ) : (
                  <div className="space-y-3">
                    {(() => {
                      const degraded = services.filter(s => s.health !== 'healthy');
                      const totalWeight = degraded.reduce((acc, s) => acc + (s.health === 'critical' ? 3 : 1), 0);
                      return degraded.map((s) => {
                        const weight = s.health === 'critical' ? 3 : 1;
                        const pct = totalWeight > 0 ? weight / totalWeight : 0;
                        const allocated = Math.round(exec!.revenue_impact_usd * pct);
                        return (
                          <div key={s.id} className="p-3 rounded-lg border border-border bg-background">
                            <div className="flex justify-between items-start mb-1">
                              <div>
                                <p className="text-sm font-semibold text-text-primary">{s.name}</p>
                                <p className="text-[10px] text-text-secondary">Health: <span className={s.health === 'critical' ? 'text-critical font-medium' : 'text-warning font-medium'}>{s.health}</span></p>
                              </div>
                              <div className="text-right">
                                <p className="text-sm font-bold text-critical">${allocated.toLocaleString()}</p>
                                <p className="text-[10px] text-text-secondary">~{Math.round(pct * 100)}% share</p>
                              </div>
                            </div>
                            <div className="w-full bg-border rounded-full h-1.5 mt-2">
                              <div className="bg-critical h-1.5 rounded-full" style={{ width: `${Math.round(pct * 100)}%` }} />
                            </div>
                          </div>
                        );
                      });
                    })()}
                  </div>
                )}
              </DrilldownSection>
            </div>

            <div className="mt-6">
              <InlineCopilot
                pageType="executive"
                selectedEntity="Revenue at Risk"
                entityData={{
                  revenue_at_risk: exec!.revenue_impact_usd,
                  contributors: services.filter(s => s.health !== 'healthy').map(s => {
                    const degraded = services.filter(s2 => s2.health !== 'healthy');
                    const totalWeight = degraded.reduce((acc, s2) => acc + (s2.health === 'critical' ? 3 : 1), 0);
                    const weight = s.health === 'critical' ? 3 : 1;
                    const pct = totalWeight > 0 ? weight / totalWeight : 0;
                    return {
                      id: s.id,
                      name: s.name,
                      health: s.health,
                      allocated_risk: Math.round(exec!.revenue_impact_usd * pct)
                    };
                  })
                }}
                relatedMetrics={{
                  revenue_risk: exec!.revenue_impact_usd,
                  active_incidents: exec!.active_incidents,
                }}
                suggestedQuestions={[
                  "How is the revenue exposure calculated?",
                  "Which service causes the highest financial risk?",
                  "What mitigation steps will reduce this risk?"
                ]}
              />
            </div>
          </div>
        )}

        {activeDrawer === 'incidents' && (
          <div>
            <div className="grid grid-cols-2 gap-4 mb-6">
              <DrilldownMetricCard
                label="Active Incidents"
                value={exec!.active_incidents}
                status={exec!.active_incidents > 0 ? 'critical' : 'good'}
              />
              <DrilldownMetricCard
                label="Open Alerts"
                value={overview.summary.open_alerts}
                status={overview.summary.open_alerts > 0 ? 'warning' : 'good'}
                onClick={() => {
                  document.getElementById('active-incidents-list-section')?.scrollIntoView({ behavior: 'smooth' });
                }}
              />
            </div>

            <div id="active-incidents-list-section">
              <DrilldownSection title="Active Incidents List" icon={<ShieldAlert className="w-4 h-4" />}>
                {overview.recent_incidents.slice(0, exec!.active_incidents).length === 0 ? (
                  <p className="text-xs text-text-secondary">No active incidents found.</p>
                ) : (
                  <div className="space-y-3">
                    {overview.recent_incidents.slice(0, exec!.active_incidents).map(inc => (
                      <div key={inc.incident_id} className="p-3 rounded-lg border border-border bg-background">
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border border-critical/30 bg-critical/10 text-critical`}>
                            {inc.severity}
                          </span>
                          <span className="text-[10px] text-text-secondary">{inc.service}</span>
                        </div>
                        <p className="text-xs font-semibold text-text-primary mb-1">{inc.title}</p>
                        <p className="text-[10px] text-text-secondary mb-3"><span className="font-medium">Root Cause:</span> {inc.root_cause}</p>
                        <div className="flex gap-2">
                          <DrilldownButton onClick={() => navigate(`/rca?id=${inc.incident_id}`)} variant="primary">
                            View RCA
                          </DrilldownButton>
                          <DrilldownButton onClick={() => navigate(`/blast-radius?id=${inc.incident_id}`)} variant="secondary">
                            Blast Radius
                          </DrilldownButton>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </DrilldownSection>
            </div>

            <div className="mt-6">
              <InlineCopilot
                pageType="executive"
                selectedEntity="Active Incidents"
                entityData={{
                  active_incidents_count: exec!.active_incidents,
                  incidents: overview.recent_incidents.slice(0, exec!.active_incidents),
                }}
                relatedIncidents={overview.recent_incidents.slice(0, exec!.active_incidents)}
                suggestedQuestions={[
                  "Can you explain the root cause of these active incidents?",
                  "What is the estimated time to resolution?",
                  "Are there correlated alerts for these incidents?"
                ]}
              />
            </div>
          </div>
        )}

        {activeDrawer === 'sla' && (
          <div>
            <div className="grid grid-cols-2 gap-4 mb-6">
              <DrilldownMetricCard
                label="Rolling 30d Compliance"
                value={`${exec!.sla_compliance.toFixed(2)}%`}
                status={exec!.sla_compliance >= 99.5 ? 'good' : exec!.sla_compliance >= 98.5 ? 'warning' : 'critical'}
                onClick={() => {
                  document.getElementById('service-sla-standings-section')?.scrollIntoView({ behavior: 'smooth' });
                }}
              />
              <DrilldownMetricCard
                label="Target SLA"
                value="99.90%"
                status="good"
              />
            </div>

            <div id="service-sla-standings-section">
              <DrilldownSection title="Service SLA Standings" icon={<TrendingUp className="w-4 h-4" />}>
                <div className="space-y-3">
                  {[...services]
                    .sort((a, b) => a.availability - b.availability)
                    .map(s => (
                      <div key={s.id} className="flex items-center justify-between p-3 rounded-lg border border-border bg-background">
                        <div>
                          <p className="text-sm font-semibold text-text-primary">{s.name}</p>
                          <p className="text-[10px] text-text-secondary">Uptime Availability</p>
                        </div>
                        <div className="text-right">
                          <p className={`text-sm font-bold ${s.availability >= 99.9 ? 'text-success' : s.availability >= 99.5 ? 'text-warning' : 'text-critical'}`}>
                            {s.availability.toFixed(2)}%
                          </p>
                          <span className={`text-[9px] px-1 rounded font-medium ${s.availability >= 99.9 ? 'bg-success/10 text-success' : 'bg-critical/10 text-critical'}`}>
                            {s.availability >= 99.9 ? 'COMPLIANT' : 'VIOLATION'}
                          </span>
                        </div>
                      </div>
                    ))}
                </div>
              </DrilldownSection>
            </div>

            <div className="mt-6">
              <InlineCopilot
                pageType="executive"
                selectedEntity="SLA Compliance"
                entityData={{
                  sla_compliance: exec!.sla_compliance,
                  service_slas: services.map(s => ({ name: s.name, availability: s.availability, compliant: s.availability >= 99.9 }))
                }}
                relatedMetrics={{
                  sla_compliance: exec!.sla_compliance,
                  service_availability: exec!.service_availability
                }}
                suggestedQuestions={[
                  "Which service is the main contributor to SLA violations?",
                  "How does the rolling 30-day window work?",
                  "Is the Gateway service meeting its uptime target?"
                ]}
              />
            </div>
          </div>
        )}

        {activeDrawer === 'customers' && (
          <div>
            <div className="grid grid-cols-2 gap-4 mb-6">
              <DrilldownMetricCard
                label="Total Customers Affected"
                value={exec!.customer_impact_count.toLocaleString()}
                status={exec!.customer_impact_count > 50 ? 'warning' : 'good'}
              />
              <DrilldownMetricCard
                label="Active Incidents"
                value={exec!.active_incidents}
                status={exec!.active_incidents > 0 ? 'critical' : 'good'}
                onClick={() => {
                  document.getElementById('customer-impact-breakdown-section')?.scrollIntoView({ behavior: 'smooth' });
                }}
              />
            </div>

            <div id="customer-impact-breakdown-section">
              <DrilldownSection title="Impact Breakdown per Incident" icon={<Users className="w-4 h-4" />}>
                {(() => {
                  const activeIncidents = overview.recent_incidents.slice(0, exec!.active_incidents);
                  const totalImpact = exec!.customer_impact_count;
                  return activeIncidents.length === 0 ? (
                    <p className="text-xs text-text-secondary">No active incident impact detected.</p>
                  ) : (
                    <div className="space-y-3">
                      {activeIncidents.map((inc, index) => {
                        let allocated = 0;
                        if (activeIncidents.length === 1) {
                          allocated = totalImpact;
                        } else if (index === 0) {
                          allocated = Math.round(totalImpact * 0.63);
                        } else {
                          allocated = totalImpact - Math.round(totalImpact * 0.63);
                        }
                        return (
                          <div key={inc.incident_id} className="p-3 rounded-lg border border-border bg-background">
                            <div className="flex justify-between items-start mb-1">
                              <div>
                                <p className="text-xs font-semibold text-text-secondary uppercase">{inc.severity} · {inc.service}</p>
                                <p className="text-xs text-text-primary font-medium mt-0.5">{inc.title}</p>
                              </div>
                              <div className="text-right shrink-0">
                                <p className="text-sm font-bold text-warning">{allocated.toLocaleString()}</p>
                                <p className="text-[9px] text-text-secondary font-medium">users affected</p>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </DrilldownSection>
            </div>

            <div className="mt-6">
              <InlineCopilot
                pageType="executive"
                selectedEntity="Customers Impacted"
                entityData={{
                  total_customer_impact: exec!.customer_impact_count,
                  active_incidents_count: exec!.active_incidents,
                  breakdown: overview.recent_incidents.slice(0, exec!.active_incidents).map((inc, index) => {
                    const activeIncidents = overview.recent_incidents.slice(0, exec!.active_incidents);
                    const totalImpact = exec!.customer_impact_count;
                    const allocated = activeIncidents.length === 1 ? totalImpact : index === 0 ? Math.round(totalImpact * 0.63) : totalImpact - Math.round(totalImpact * 0.63);
                    return {
                      incident_id: inc.incident_id,
                      service: inc.service,
                      title: inc.title,
                      severity: inc.severity,
                      allocated_impact: allocated
                    };
                  })
                }}
                relatedIncidents={overview.recent_incidents.slice(0, exec!.active_incidents)}
                suggestedQuestions={[
                  "Which incident affects the largest number of users?",
                  "How is user impact calculated?",
                  "What is the status of the Payment Authorization mitigation?"
                ]}
              />
            </div>
          </div>
        )}
      </DrilldownDrawer>

      {/* Drilldown Drawer for Regional Operations */}
      <DrilldownDrawer
        isOpen={selectedRegion !== null}
        onClose={() => setSelectedRegion(null)}
        title={selectedRegion ? `${selectedRegion.label} Regional Operations` : ''}
        subtitle="Regional metrics, service status, and active incidents"
        type="node"
        health={selectedRegion?.health}
      >
        {selectedRegion && (
          <div>
            <div className="grid grid-cols-2 gap-4 mb-6">
              <DrilldownMetricCard
                label="Regional SLA / Availability"
                value={selectedRegion.health === 'critical' ? '98.54%' : selectedRegion.health === 'warning' ? '99.41%' : '99.98%'}
                status={selectedRegion.health === 'critical' ? 'critical' : selectedRegion.health === 'warning' ? 'warning' : 'good'}
              />
              <DrilldownMetricCard
                label="Average P99 Latency"
                value={selectedRegion.health === 'critical' ? '242.5ms' : selectedRegion.health === 'warning' ? '184.2ms' : '88.1ms'}
                status={selectedRegion.health === 'critical' ? 'critical' : selectedRegion.health === 'warning' ? 'warning' : 'good'}
              />
            </div>

            <DrilldownSection title="Active Incidents in Region" icon={<ShieldAlert className="w-4 h-4" />}>
              {selectedRegion.health === 'healthy' ? (
                <p className="text-xs text-text-secondary">No active incidents in this region.</p>
              ) : (
                <div className="space-y-3">
                  {overview.recent_incidents
                    .filter(inc => {
                      if (selectedRegion.id === 'ap-northeast') {
                        return inc.service.includes('Settlement') || inc.service.includes('Partner');
                      }
                      if (selectedRegion.id === 'eu-west') {
                        return inc.service.includes('Payment') || inc.service.includes('Merchant');
                      }
                      return false;
                    })
                    .slice(0, 1)
                    .map(inc => (
                      <div key={inc.incident_id} className="p-3 rounded-lg border border-border bg-background">
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border border-critical/30 bg-critical/10 text-critical">
                            {inc.severity}
                          </span>
                          <span className="text-[10px] text-text-secondary">{inc.service}</span>
                        </div>
                        <p className="text-xs font-semibold text-text-primary mb-1">{inc.title}</p>
                        <p className="text-[10px] text-text-secondary mb-3"><span className="font-medium">Root Cause:</span> {inc.root_cause}</p>
                        <div className="flex gap-2">
                          <DrilldownButton onClick={() => { setSelectedRegion(null); navigate(`/rca?id=${inc.incident_id}`); }} variant="primary">
                            View RCA
                          </DrilldownButton>
                          <DrilldownButton onClick={() => { setSelectedRegion(null); navigate(`/blast-radius?id=${inc.incident_id}`); }} variant="secondary">
                            Blast Radius
                          </DrilldownButton>
                        </div>
                      </div>
                    ))}
                  {overview.recent_incidents.filter(inc => {
                    if (selectedRegion.id === 'ap-northeast') return inc.service.includes('Settlement') || inc.service.includes('Partner');
                    if (selectedRegion.id === 'eu-west') return inc.service.includes('Payment') || inc.service.includes('Merchant');
                    return false;
                  }).length === 0 && (
                      <p className="text-xs text-text-secondary">Incident details currently compiling. Review overall incidents explorer.</p>
                    )}
                </div>
              )}
            </DrilldownSection>

            <DrilldownSection title="Regional Services Status" icon={<Activity className="w-4 h-4" />}>
              <div className="space-y-3">
                {services
                  .filter(s => {
                    if (selectedRegion.id === 'ap-northeast') return s.id === 'settlement-processing' || s.id === 'partner-integrations' || s.id === 'fraud-detection';
                    if (selectedRegion.id === 'eu-west') return s.id === 'payment-authorization' || s.id === 'merchant-services';
                    if (selectedRegion.id === 'us-east' || selectedRegion.id === 'us-west') return s.id === 'api-gateway-services' || s.id === 'fraud-detection';
                    return s.health !== 'healthy';
                  })
                  .map(s => (
                    <div key={s.id} className="flex items-center justify-between p-3 rounded-lg border border-border bg-background">
                      <div>
                        <p className="text-sm font-semibold text-text-primary">{s.name}</p>
                        <p className="text-[10px] text-text-secondary">Availability: {s.availability.toFixed(2)}% · Latency: {s.latency_p99_ms.toFixed(1)}ms</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <HealthBadge health={s.health} />
                        <Link to={`/services/${s.id}`} className="p-1 hover:bg-card-hover rounded font-semibold text-primary" title="View details">
                          <ExternalLink className="w-4 h-4" />
                        </Link>
                      </div>
                    </div>
                  ))}
                {services.filter(s => {
                  if (selectedRegion.id === 'ap-northeast') return s.id === 'settlement-processing' || s.id === 'partner-integrations' || s.id === 'fraud-detection';
                  if (selectedRegion.id === 'eu-west') return s.id === 'payment-authorization' || s.id === 'merchant-services';
                  if (selectedRegion.id === 'us-east' || selectedRegion.id === 'us-west') return s.id === 'api-gateway-services' || s.id === 'fraud-detection';
                  return s.health !== 'healthy';
                }).length === 0 && (
                    <p className="text-xs text-text-secondary">No regional microservice constraints active. Standard gateway routing healthy.</p>
                  )}
              </div>
            </DrilldownSection>

            <div className="mt-6">
              <InlineCopilot
                pageType="executive"
                selectedEntity={`${selectedRegion.label} Region`}
                entityData={{
                  region_id: selectedRegion.id,
                  region_name: selectedRegion.label,
                  health: selectedRegion.health,
                  incidents: overview.recent_incidents.filter(inc => {
                    if (selectedRegion.id === 'ap-northeast') return inc.service.includes('Settlement') || inc.service.includes('Partner');
                    if (selectedRegion.id === 'eu-west') return inc.service.includes('Payment') || inc.service.includes('Merchant');
                    return false;
                  })
                }}
                suggestedQuestions={[
                  `Why is the ${selectedRegion.label} region in a ${selectedRegion.health} state?`,
                  "What services run in this region?",
                  "Is there a network degradation affecting regional latency?"
                ]}
              />
            </div>
          </div>
        )}
      </DrilldownDrawer>
    </div>
  );
}
