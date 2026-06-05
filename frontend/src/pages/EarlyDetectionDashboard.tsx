import { useEffect, useState } from 'react';
import { analyzeEarlyDetection } from '../api/client';
import type { EarlyDetection } from '../types/intelligence';
import { PageHeader, ConfidenceBar, TagList } from '../components/ui';

export default function EarlyDetectionDashboard() {
  const [detections, setDetections] = useState<EarlyDetection[]>([]);
  const [conditions, setConditions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    analyzeEarlyDetection()
      .then((r) => { setDetections(r.detections); setConditions(r.current_conditions); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  return (
    <div>
      <PageHeader
        title="Early Failure Detection"
        description="Detect probable incidents forming from historical alert/symptom patterns"
      />

      <div className="flex gap-3 mb-6">
        <button onClick={load} className="px-4 py-2 text-sm bg-blue-600 rounded-lg">Refresh Detection</button>
      </div>

      <div className="p-4 bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl mb-6">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-2">Current Conditions (from open alerts)</h3>
        {loading ? (
          <p className="text-slate-500 text-sm">Loading...</p>
        ) : conditions.length === 0 ? (
          <p className="text-slate-500 text-sm">No active alert conditions</p>
        ) : (
          <TagList items={conditions} color="red" />
        )}
      </div>

      {detections.length === 0 && !loading ? (
        <div className="p-8 text-center text-slate-500 border border-dashed border-slate-200 dark:border-slate-700 rounded-xl">
          No early failure patterns matched current conditions
        </div>
      ) : (
        <div className="space-y-4">
          {detections.map((d) => (
            <div key={d.pattern_id} className="p-5 bg-red-50 dark:bg-red-950/20 border border-red-500/30 rounded-xl">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <span className="text-xs px-2 py-0.5 bg-red-100 dark:bg-red-500/20 text-red-800 dark:text-red-300 rounded font-medium">PROBABLE INCIDENT FORMING</span>
                  <h3 className="text-lg font-semibold text-slate-900 dark:text-white mt-2">{d.expected_impacted_service}</h3>
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    ETA: {d.estimated_time_to_incident_minutes} min · Historical occurrences: {d.occurrence_count_historical}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-3xl font-bold text-red-600 dark:text-red-400">{d.confidence}%</p>
                  <p className="text-xs text-slate-600 dark:text-slate-400">confidence</p>
                </div>
              </div>

              <ConfidenceBar value={d.confidence} />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                <div>
                  <p className="text-xs text-slate-600 dark:text-slate-400 mb-1">Matched Alerts</p>
                  <TagList items={d.matched_alerts} color="red" />
                </div>
                <div>
                  <p className="text-xs text-slate-600 dark:text-slate-400 mb-1">Expected Symptoms</p>
                  <TagList items={d.expected_symptoms} color="yellow" />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                <div>
                  <p className="text-xs font-semibold text-slate-900 dark:text-white mb-2">Recommended Proactive Actions</p>
                  <ul className="text-xs text-slate-500 dark:text-slate-400 space-y-1">
                    {d.recommended_actions.map((a) => <li key={a}>→ {a}</li>)}
                  </ul>
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-900 dark:text-white mb-2">Evidence Collection Plan</p>
                  <ul className="text-xs text-slate-500 dark:text-slate-400 space-y-1">
                    {d.evidence_collection_plan.map((e) => <li key={e}>• {e}</li>)}
                  </ul>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
