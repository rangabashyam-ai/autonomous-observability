import { useEffect, useState } from 'react';
import { getDataStatus, uploadDataFile, uploadDatasetJson, addIncident } from '../api/client';
import { PageHeader } from '../components/ui';

export default function DataAdminPage() {
  const [message, setMessage] = useState('');
  const [toastMessage, setToastMessage] = useState('');

  const load = () => getDataStatus().then(() => {});

  useEffect(() => { load(); }, []);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(''), 3000);
  };

  const handleUpload = async (category: string, file: File) => {
    try {
      await uploadDataFile(category, file);
      setMessage(`Uploaded to ${category}`);
      load();
    } catch {
      setMessage('Upload failed');
    }
  };

  const [uploadingJson, setUploadingJson] = useState(false);
  const handleJsonUpload = async (file: File) => {
    setUploadingJson(true);
    setMessage('');
    try {
      await uploadDatasetJson(file);
      setMessage('Dataset JSON uploaded and activated successfully!');
      load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'JSON upload failed.');
    } finally {
      setUploadingJson(false);
    }
  };

  // Form states for adding incidents (openRCA_Bank dataset format)
  const [incidentId, setIncidentId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState('Low');
  const [status, setStatus] = useState('New');
  const [productName, setProductName] = useState('BankRCA');
  const [startTime, setStartTime] = useState(new Date().toISOString().slice(0, 16));
  const [endTime, setEndTime] = useState(new Date(Date.now() + 1800000).toISOString().slice(0, 16));
  const [entities, setEntities] = useState('');
  const [tactics, setTactics] = useState<string[]>([]);
  const [rootCause] = useState('');
  const [suggestedFix] = useState('');
  const [alerts, setAlerts] = useState<{ alertRule: string; severity: string; signalType: string; firedAt: string; description: string }[]>([]);
  const [customTactic, setCustomTactic] = useState('');
  const [duplicateConflict, setDuplicateConflict] = useState(false);
  const [pendingPayload, setPendingPayload] = useState<object | null>(null);
  const [submitting, setSubmitting] = useState(false);


  const buildPayload = () => ({
    incidentId,
    schemaId: "commonObservabilityIncidentSchema",
    schemaVersion: "1.0",
    title,
    description,
    severity,
    status,
    productName,
    timeWindow: { start: startTime, end: endTime },
    alerts: {
      count: alerts.length,
      items: alerts.map(a => ({
        alertId: Math.random().toString(36).substring(2, 15),
        ...a
      }))
    },
    evidence: { alertCount: alerts.length, eventCount: 0, bookmarkCount: 0 },
    entities: entities.split(',').map(e => e.trim()).filter(Boolean),
    tactics: [
      ...tactics,
      ...(customTactic.trim() ? [customTactic.trim()] : [])
    ],
    queryIndex: 'Q' + Math.floor(1000 + Math.random() * 9000),
    taskType: 'task_1',
    rcaStatus: 'Pending',
    root_cause: rootCause,
    fix: suggestedFix
  });

  const submitIncident = async (payload: object, overwrite = false) => {
    setSubmitting(true);
    setMessage('');
    try {
      await addIncident({ ...payload, overwrite });
      showToast(`Incident ${incidentId} added successfully!`);
      setDuplicateConflict(false);
      setPendingPayload(null);
      load();
      // Reset all form fields to blank for the next entry
      setIncidentId('');
      setTitle('');
      setDescription('');
      setSeverity('Low');
      setStatus('New');
      setProductName('BankRCA');
      setStartTime(new Date().toISOString().slice(0, 16));
      setEndTime(new Date(Date.now() + 1800000).toISOString().slice(0, 16));
      setEntities('');
      setTactics([]);
      setCustomTactic('');
      setAlerts([]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to add incident.';
      // Detect duplicate — backend returns 409 with message containing 'already exists'
      if (msg.toLowerCase().includes('already exists')) {
        setPendingPayload(payload);
        setDuplicateConflict(true);
        setMessage('');
      } else {
        setMessage(msg);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddIncident = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !description || !incidentId) {
      setMessage('Please fill in required fields: ID, Title, and Description.');
      return;
    }
    await submitIncident(buildPayload(), false);
  };


  return (
    <div>
      <PageHeader
        title="Custom Data Upload"
        description="Upload incident datasets and create custom incidents in openRCA_Bank format"
      />

      {message && (
        <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-500/30 rounded-lg text-sm text-blue-300">{message}</div>
      )}

      {/* Floating Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-blue-600 text-white px-6 py-3 rounded-xl shadow-lg font-medium flex items-center gap-3 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          {toastMessage}
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <label className="inline-flex items-center px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 active:scale-[0.98] text-white rounded-lg cursor-pointer font-medium transition-all shadow-sm">
          {uploadingJson ? (
            <>
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2"></span>
              <span>Uploading JSON...</span>
            </>
          ) : (
            <span>Upload Dataset JSON (.json)</span>
          )}
          <input
            type="file"
            accept=".json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleJsonUpload(file);
            }}
            disabled={uploadingJson}
          />
        </label>
      </div>


      <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">Upload Custom JSON</h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {['incidents', 'alerts', 'dependencies', 'knowledge-graph'].map((cat) => (
          <label key={cat} className="p-4 bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl cursor-pointer hover:border-blue-500 text-center">
            <p className="text-sm text-slate-900 dark:text-white capitalize">{cat.replace('-', ' ')}</p>
            <p className="text-xs text-slate-500 mt-1">Click to upload JSON</p>
            <input
              type="file"
              accept=".json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleUpload(cat, file);
              }}
            />
          </label>
        ))}
      </div>
      <div className="mt-8 p-6 bg-white dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700/60 rounded-2xl shadow-sm">
        <h3 className="text-base font-semibold text-slate-900 dark:text-white mb-1">Create Custom Incident Form</h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-6">Create a single incident in the openRCA_Bank format directly into the dataset.</p>

        <form onSubmit={handleAddIncident} className="space-y-6">

          {/* Duplicate conflict banner */}
          {duplicateConflict && (
            <div className="flex items-center justify-between gap-4 p-4 bg-amber-50 dark:bg-amber-950/30 border border-amber-400/40 rounded-xl">
              <div>
                <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">⚠ Incident already exists</p>
                <p className="text-xs text-amber-600 dark:text-amber-500 mt-0.5">An incident with ID <span className="font-mono font-bold">{incidentId}</span> already exists. Do you want to overwrite it?</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => { setDuplicateConflict(false); setPendingPayload(null); }}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-all"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => pendingPayload && submitIncident(pendingPayload, true)}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-500 hover:bg-amber-400 text-white transition-all disabled:opacity-50"
                >
                  {submitting ? 'Overwriting...' : 'Yes, Overwrite'}
                </button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Incident ID *</label>
              <input
                type="text"
                placeholder="e.g. INC-1234"
                value={incidentId}
                onChange={(e) => setIncidentId(e.target.value)}
                className="w-full text-sm px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:border-blue-500 font-mono"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Title *</label>
              <input
                type="text"
                placeholder="High CPU Load on TomcatCluster"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full text-sm px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:border-blue-500"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Product Name</label>
              <input
                type="text"
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                className="w-full text-sm px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Description *</label>
            <textarea
              placeholder="Provide a detailed description of the incident..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full text-sm px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:border-blue-500"
              required
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Severity</label>
              <select
                value={severity}
                onChange={(e) => setSeverity(e.target.value)}
                className="w-full text-sm px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:border-blue-500"
              >
                <option value="Low">Low</option>
                <option value="Medium">Medium</option>
                <option value="High">High</option>
                <option value="Critical">Critical</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full text-sm px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:border-blue-500"
              >
                <option value="New">New</option>
                <option value="Active">Active</option>
                <option value="Resolved">Resolved</option>
                <option value="Closed">Closed</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Start Time *</label>
              <input
                type="datetime-local"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full text-sm px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:border-blue-500"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">End Time *</label>
              <input
                type="datetime-local"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full text-sm px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:border-blue-500"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">CMDB Entities (comma separated) *</label>
              <input
                type="text"
                placeholder="IG01, Tomcat01, ServiceTest3"
                value={entities}
                onChange={(e) => setEntities(e.target.value)}
                className="w-full text-sm px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:border-blue-500"
                required
              />
            </div>
            {/* <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">True Root Cause</label>
              <input
                type="text"
                placeholder="High CPU Load"
                value={rootCause}
                onChange={(e) => setRootCause(e.target.value)}
                className="w-full text-sm px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:border-blue-500"
              />
            </div> */}
          </div>

          {/* <div>
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Suggested Fix</label>
            <input
              type="text"
              placeholder="Investigate logs..."
              value={suggestedFix}
              onChange={(e) => setSuggestedFix(e.target.value)}
              className="w-full text-sm px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:border-blue-500"
            />
          </div> */}

          <div>
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">Symptoms (Tactics)</label>
            <div className="flex flex-wrap gap-4 bg-slate-50 dark:bg-slate-900/50 p-4 rounded-xl border border-slate-200 dark:border-slate-700/60">
              {['Network Disruption', 'Performance Degradation', 'Resource Exhaustion', 'Service Degradation'].map((t) => (
                <label key={t} className="inline-flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={tactics.includes(t)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setTactics([...tactics, t]);
                      } else {
                        setTactics(tactics.filter(x => x !== t));
                      }
                    }}
                    className="rounded border-slate-300 text-blue-605 focus:ring-blue-500"
                  />
                  <span>{t}</span>
                </label>
              ))}
              <div className="w-full mt-1 flex items-center gap-2">
                <span className="text-xs text-slate-400 shrink-0">Custom:</span>
                <input
                  type="text"
                  placeholder="e.g. Data Corruption, Auth Failure..."
                  value={customTactic}
                  onChange={(e) => setCustomTactic(e.target.value)}
                  className="flex-1 text-sm px-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400">Alerts ({alerts.length})</label>
              <button
                type="button"
                onClick={() => setAlerts([...alerts, { alertRule: '', severity: 'Sev2', signalType: 'Metric', firedAt: new Date().toISOString().slice(0, 16), description: '' }])}
                className="px-3 py-1 text-xs font-semibold bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/20 rounded-lg transition-all"
              >
                + Add Alert
              </button>
            </div>

            <div className="space-y-3">
              {alerts.map((a, idx) => (
                <div key={idx} className="p-4 bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700/60 rounded-xl relative">
                  <button
                    type="button"
                    onClick={() => setAlerts(alerts.filter((_, i) => i !== idx))}
                    className="absolute top-3 right-3 text-xs text-red-400 hover:text-red-300 font-semibold"
                  >
                    Remove
                  </button>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pr-12">
                    <div>
                      <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">Alert Rule *</label>
                      <input
                        type="text"
                        placeholder="BankRCA-Tomcat01-TRACE_SLOW"
                        value={a.alertRule}
                        onChange={(e) => {
                          const updated = [...alerts];
                          updated[idx].alertRule = e.target.value;
                          setAlerts(updated);
                        }}
                        className="w-full text-xs px-2.5 py-1.5 bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-700 rounded-md focus:outline-none focus:border-blue-500"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">Severity</label>
                      <select
                        value={a.severity}
                        onChange={(e) => {
                          const updated = [...alerts];
                          updated[idx].severity = e.target.value;
                          setAlerts(updated);
                        }}
                        className="w-full text-xs px-2.5 py-1.5 bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-700 rounded-md focus:outline-none"
                      >
                        <option value="Sev1">Sev1</option>
                        <option value="Sev2">Sev2</option>
                        <option value="Sev3">Sev3</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">Signal Type</label>
                      <select
                        value={a.signalType}
                        onChange={(e) => {
                          const updated = [...alerts];
                          updated[idx].signalType = e.target.value;
                          setAlerts(updated);
                        }}
                        className="w-full text-xs px-2.5 py-1.5 bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-700 rounded-md focus:outline-none"
                      >
                        <option value="Metric">Metric</option>
                        <option value="Log">Log</option>
                        <option value="Trace">Trace</option>
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3 pr-12">
                    <div>
                      <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">Fired At *</label>
                      <input
                        type="datetime-local"
                        value={a.firedAt}
                        onChange={(e) => {
                          const updated = [...alerts];
                          updated[idx].firedAt = e.target.value;
                          setAlerts(updated);
                        }}
                        className="w-full text-xs px-2.5 py-1.5 bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-700 rounded-md focus:outline-none"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">Description</label>
                      <input
                        type="text"
                        placeholder="Slow Tomcat traces..."
                        value={a.description}
                        onChange={(e) => {
                          const updated = [...alerts];
                          updated[idx].description = e.target.value;
                          setAlerts(updated);
                        }}
                        className="w-full text-xs px-2.5 py-1.5 bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-700 rounded-md focus:outline-none"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-slate-100 dark:border-slate-700/60">
            <button
              type="submit"
              disabled={submitting}
              className="px-6 py-2.5 text-sm font-semibold bg-blue-600 hover:bg-blue-500 active:scale-[0.98] transition-all text-white rounded-xl shadow-md disabled:opacity-50"
            >
              {submitting ? 'Adding Incident...' : 'Add Incident to Dataset'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
