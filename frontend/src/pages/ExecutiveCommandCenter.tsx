import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getMonitoringDashboard, getOverview } from '../api/client';
import type { Overview } from '../types/intelligence';
import type { MonitoringDashboard } from '../types/api';
import { PageHeader, Grid12, CollapsibleSection } from '../components/ui/layout-primitives';
import { MetricCard } from '../components/ui/metric-card';
import { Card, CardHeader, CardTitle } from '../components/ui/card';
import { Badge, HealthBadge } from '../components/ui/badge';
import { generateDualTrend, generateTrend, TrendChart, MiniAreaChart } from '../components/charts/charts';
import { RegionalHealthMap, UtilizationBar } from '../components/dashboard/visualizations';
import { Sparkles } from 'lucide-react';

export default function ExecutiveCommandCenter() {
  const [monitoring, setMonitoring] = useState<MonitoringDashboard | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);

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
        <div className="col-span-12 sm:col-span-6 lg:col-span-2">
          <MetricCard
            label="Business Health Score"
            value={`${businessHealth}%`}
            variant={businessHealth >= 95 ? 'success' : businessHealth >= 85 ? 'warning' : 'critical'}
            sub="Composite SLA + availability"
            trend={1.2}
          />
        </div>
        <div className="col-span-12 sm:col-span-6 lg:col-span-2">
          <MetricCard
            label="Revenue at Risk"
            value={`$${exec!.revenue_impact_usd.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
            variant="critical"
            sub="Estimated 24h exposure"
            trend={-3.4}
          />
        </div>
        <div className="col-span-12 sm:col-span-6 lg:col-span-2">
          <MetricCard
            label="Active Incidents"
            value={exec!.active_incidents}
            variant={exec!.active_incidents > 0 ? 'critical' : 'success'}
            sub={`${overview.summary.open_alerts} open alerts`}
          />
        </div>
        <div className="col-span-12 sm:col-span-6 lg:col-span-3">
          <MetricCard
            label="SLA Compliance"
            value={`${exec!.sla_compliance.toFixed(2)}%`}
            variant="success"
            sub="Rolling 30-day window"
            trend={0.08}
          />
        </div>
        <div className="col-span-12 sm:col-span-6 lg:col-span-3">
          <MetricCard
            label="Customers Impacted"
            value={exec!.customer_impact_count.toLocaleString()}
            variant={exec!.customer_impact_count > 50 ? 'warning' : 'default'}
            sub="Across all active incidents"
          />
        </div>
      </Grid12>

      <CollapsibleSection title="Executive Intelligence" description="AI summary and business impact trends">
        <Grid12>
          <div className="col-span-12 lg:col-span-5">
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
          <div className="col-span-12 lg:col-span-4">
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
          <div className="col-span-12 lg:col-span-3">
            <Card className="h-full">
              <CardHeader>
                <CardTitle>Revenue Risk Timeline</CardTitle>
              </CardHeader>
              <MiniAreaChart data={revenueTrend} height={120} color="#EF4444" />
              <p className="text-xs text-text-secondary mt-2">
                Peak exposure: ${Math.max(...revenueTrend.map((d) => d.value)).toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </p>
            </Card>
          </div>
        </Grid12>
      </CollapsibleSection>

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
              <div className="space-y-3">
                {services.slice(0, 6).map((svc) => (
                  <div key={svc.id} className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-text-primary truncate">{svc.name}</p>
                      <UtilizationBar label="" value={svc.availability} max={100} />
                    </div>
                    <HealthBadge health={svc.health} />
                  </div>
                ))}
              </div>
            </Card>
          </div>
          <div className="col-span-12 lg:col-span-4">
            <Card className="h-full">
              <CardHeader>
                <CardTitle>Regional Health Map</CardTitle>
              </CardHeader>
              <RegionalHealthMap className="h-[180px]" />
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
                  { label: 'Transaction Volume', value: services.reduce((a, s) => a + s.transaction_volume, 0) },
                  { label: 'Success Rate', value: `${exec!.transaction_success_rate.toFixed(1)}%` },
                  { label: 'Services at Risk', value: exec!.services_at_risk, alert: true },
                  { label: 'Early Warnings', value: overview.summary.early_warnings, alert: overview.summary.early_warnings > 0 },
                ].map((kpi) => (
                  <div
                    key={kpi.label}
                    className="rounded-lg border border-border bg-background p-3 transition-colors hover:bg-card-hover"
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
  );
}
