import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getOverview, getIncidentClickAnalysis, getIncidentChangeRequests, getMonitoringDashboard } from '../api/client';
import type { Overview, Incident, IncidentClickAnalysis } from '../types/intelligence';
import { PageHeader, StatCard, severityClass } from '../components/ui';
import { IncidentPopup } from './IncidentExplorer';
import DrilldownDrawer, { DrilldownSection } from '../components/drilldown/DrilldownDrawer';
import { Card } from '../components/ui/card';
import DatasetUploadBanner from '../components/DatasetUploadBanner';
import { EMPTY_OVERVIEW, NO_DATA_MESSAGE } from '../utils/emptyState';

export default function HomeOverview() {
  const [data, setData] = useState<Overview | null>(null);
  const [noData, setNoData] = useState(false);
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);
  const [analysis, setAnalysis] = useState<IncidentClickAnalysis | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [changeRequests, setChangeRequests] = useState<any | null>(null);
  const [selectedWarning, setSelectedWarning] = useState<any | null>(null);

  useEffect(() => {
    getMonitoringDashboard()
      .then((monitoring) => {
        if (monitoring.dataset_available !== true) {
          setNoData(true);
          setData(EMPTY_OVERVIEW);
          return;
        }
        return getOverview().then(setData).catch(console.error);
      })
      .catch(console.error);
  }, []);

  const handleIncidentClick = (inc: any) => {
    const compliant: Incident = {
      incident_id: inc.incident_id,
      title: inc.title,
      severity: inc.severity,
      service: inc.service,
      root_cause: inc.root_cause || '',
      state: inc.state || 'Open',
      owner_team: inc.owner_team || 'Platform Team',
      environment: inc.environment || 'Production',
      region: inc.region || 'us-east',
      duration_minutes: inc.duration_minutes || 0,
      alerts: inc.alerts || [],
      symptoms: inc.symptoms || [],
      impacted_components: inc.impacted_components || [],
      similar_incidents: inc.similar_incidents || [],
      fix: inc.fix || '',
      start_time: inc.start_time || '',
      end_time: inc.end_time || ''
    };
    setSelectedIncident(compliant);
    setAnalysis(null);
    setAnalysisError(null);
    setAnalysisLoading(true);
    setChangeRequests(null);
    getIncidentClickAnalysis(compliant.incident_id)
      .then(setAnalysis)
      .catch((err) => setAnalysisError(err?.message ?? 'Analysis failed'))
      .finally(() => setAnalysisLoading(false));
    getIncidentChangeRequests(compliant.incident_id)
      .then((r) => setChangeRequests({ tickets: r.tickets }))
      .catch(() => setChangeRequests(null));
  };

  if (!data) return <p className="text-slate-500 dark:text-slate-400">Loading command center...</p>;

  const s = data.summary;

  return (
    <div>
      <PageHeader
        title="Operations Command Center"
        description="Unified view of incidents, alerts, knowledge graph intelligence, and early warnings"
      />

      {noData && <DatasetUploadBanner />}

      {noData ? (
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/50 p-12 text-center">
          <p className="text-sm text-slate-500 dark:text-slate-400">{NO_DATA_MESSAGE}</p>
        </div>
      ) : (
      <>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        <StatCard label="Resolved Incidents" value={s.total_incidents} sub="Historical knowledge" />
        <StatCard label="Open Alerts" value={s.open_alerts} alert={s.open_alerts > 10} />
        <StatCard label="Graph Nodes" value={s.knowledge_graph_nodes} sub="RCA knowledge" />
        <StatCard label="Graph Edges" value={s.knowledge_graph_edges} sub="Relationships" />
        <StatCard label="Early Warnings" value={s.early_warnings} alert={s.early_warnings > 0} />
        <StatCard label="Active Investigations" value={s.active_investigations} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="bg-white dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
          <div className="flex justify-between items-center mb-3">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Recent Incidents</h3>
            <Link to="/incidents" className="text-xs text-blue-700 dark:text-blue-400 hover:underline">View all →</Link>
          </div>
          <div className="space-y-2">
            {data.recent_incidents.slice(0, 6).map((inc) => (
              <button
                key={inc.incident_id}
                onClick={() => handleIncidentClick(inc)}
                className="w-full text-left block p-3 bg-slate-100 dark:bg-slate-900/50 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer border border-transparent hover:border-primary/20"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border ${severityClass(inc.severity)}`}>{inc.severity}</span>
                  <span className="text-xs text-slate-600 dark:text-slate-400">{inc.incident_id}</span>
                </div>
                <p className="text-sm text-slate-900 dark:text-white font-semibold font-sans">{inc.title}</p>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">RC: {inc.root_cause}</p>
              </button>
            ))}
          </div>
        </section>

        <section className="bg-white dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
          <div className="flex justify-between items-center mb-3">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Early Failure Warnings</h3>
            <Link to="/early-detection" className="text-xs text-blue-700 dark:text-blue-400 hover:underline">Details →</Link>
          </div>
          {data.early_detections.length === 0 ? (
            <p className="text-sm text-slate-600 dark:text-slate-400">No active patterns detected</p>
          ) : (
            data.early_detections.map((d, i) => (
              <button
                key={`${d.pattern_id}-${i}`}
                onClick={() => setSelectedWarning(d)}
                className="w-full text-left block p-3 bg-red-50 dark:bg-red-950/20 border border-red-500/30 rounded-lg mb-2 cursor-pointer hover:bg-red-500/10 transition-all"
              >
                <div className="flex justify-between">
                  <span className="text-sm text-red-700 dark:text-red-300 font-semibold font-sans">Probable incident forming</span>
                  <span className="text-sm font-bold text-red-600 dark:text-red-400">{d.confidence}%</span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                  {d.expected_impacted_service} · ETA {d.estimated_time_to_incident_minutes} min
                </p>
              </button>
            ))
          )}

          <h3 className="text-sm font-semibold text-slate-900 dark:text-white mt-4 mb-2">Top Root Causes</h3>
          {data.top_root_causes.map((rc) => (
            <div key={rc.root_cause} className="flex justify-between text-xs py-1.5 border-b border-slate-100 dark:border-slate-800">
              <span className="text-slate-700 dark:text-slate-300">{rc.root_cause}</span>
              <span className="text-slate-600 dark:text-slate-400 font-mono">{rc.count} incidents</span>
            </div>
          ))}
        </section>

        <section className="lg:col-span-2 bg-white dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">Quick Actions</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { to: '/rca', label: 'Run RCA Analysis', desc: 'Predict root causes' },
              { to: '/blast-radius', label: 'Blast Radius', desc: 'Impact prediction' },
              { to: '/investigation', label: 'Start Investigation', desc: 'AI workflow' },
              { to: '/copilot', label: 'Ask Copilot', desc: 'Natural language ops' },
            ].map((a) => (
              <Link key={a.to} to={a.to} className="p-3 bg-slate-100 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg hover:border-blue-500/50 transition-colors">
                <p className="text-sm font-medium text-slate-900 dark:text-white">{a.label}</p>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">{a.desc}</p>
              </Link>
            ))}
          </div>
        </section>
      </div>
      </>
      )}

      {/* Incident Detail Drawer */}
      {selectedIncident && (
        <IncidentPopup
          incident={selectedIncident}
          analysis={analysis}
          analysisLoading={analysisLoading}
          analysisError={analysisError}
          changeRequests={changeRequests}
          onClose={() => setSelectedIncident(null)}
          onResolved={(updated) => {
            setSelectedIncident(updated);
            if (data) {
              setData({
                ...data,
                recent_incidents: data.recent_incidents.map(inc => inc.incident_id === updated.incident_id ? updated : inc)
              });
            }
          }}
        />
      )}

      {/* Early Warning Detail Drawer */}
      <DrilldownDrawer
        isOpen={selectedWarning !== null}
        onClose={() => setSelectedWarning(null)}
        title={selectedWarning ? `Imminent Precursor: ${selectedWarning.expected_impacted_service}` : ''}
        subtitle="Probable incident pattern details and warning levels"
        type="incident"
        health="critical"
      >
        {selectedWarning && (
          <div className="space-y-6 text-left">
            <Card className="p-4 bg-red-500/10 border-red-500/20">
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs font-bold text-critical font-sans">Risk Level: High</span>
                <span className="text-sm font-bold text-critical">{selectedWarning.confidence}% confidence</span>
              </div>
              <h4 className="text-sm font-bold text-text-primary mb-1">{selectedWarning.expected_impacted_service}</h4>
              <p className="text-xs text-text-secondary mt-1">
                Estimated time to incident: <span className="font-semibold text-text-primary">{selectedWarning.estimated_time_to_incident_minutes} minutes</span>
              </p>
            </Card>

            <DrilldownSection title="Golden Signal Precursors">
              <div className="p-3 bg-card-hover rounded-lg text-xs text-text-primary font-mono space-y-1">
                {selectedWarning.matched_alerts?.map((a: string) => (
                  <p key={a}>⚠ {a}</p>
                )) || <p>No specific precursors listed.</p>}
              </div>
            </DrilldownSection>

            <DrilldownSection title="Recommended Mitigation Actions">
              <ul className="list-disc pl-4 text-xs text-text-secondary space-y-1.5">
                {selectedWarning.recommended_actions?.map((act: string) => (
                  <li key={act}>{act}</li>
                )) || <li>Check cluster configuration settings.</li>}
              </ul>
            </DrilldownSection>
          </div>
        )}
      </DrilldownDrawer>
    </div>
  );
}
