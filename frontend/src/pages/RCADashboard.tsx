import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, RefreshCw, ChevronDown, History, GitCompare, Brain, AlertCircle, CheckCircle, Clock, TrendingUp, Zap, Activity } from 'lucide-react';
import { analyzeRCA } from '../api/client';
import type { RCAResult } from '../types/intelligence';
import { PageHeader, ConfidenceBar, TagList, inputClass, selectClass, btnPrimary, emptyState, textMuted, textLink, textDanger, textAccent } from '../components/ui';

const ALERT_OPTIONS = [
  'CPU Saturation', 'API Error Spike', 'Packet Loss', 'Disk I/O Saturation',
  'Memory Pressure', 'Connection Pool Exhaustion', 'Queue Buildup Alert', 'Network Latency Alert',
];

const SYMPTOM_OPTIONS = [
  'Latency Increase', 'Retry Storm', 'Queue Buildup', 'Timeout Increase',
  'Connection Refused', 'Throughput Drop', 'Error Rate Spike',
];

const SERVICES = [
  'payment-authorization', 'settlement-processing', 'fraud-detection',
  'merchant-services', 'api-gateway-services', 'partner-integrations',
];

interface RCAHistory {
  timestamp: string;
  user: string;
  version: string;
  rootCause: string;
  confidence: number;
  analysisType: string;
}

interface SearchResult {
  type: 'incident' | 'service' | 'alert' | 'rca';
  id: string;
  title: string;
  subtitle?: string;
  relevance: number;
}

export default function RCADashboard() {
  const [alerts, setAlerts] = useState<string[]>(['CPU Saturation', 'API Error Spike']);
  const [symptoms, setSymptoms] = useState<string[]>(['Latency Increase', 'Retry Storm']);
  const [service, setService] = useState('payment-authorization');
  const [timeWindow, setTimeWindow] = useState(24);
  const [result, setResult] = useState<RCAResult | null>(null);
  const [previousResult, setPreviousResult] = useState<RCAResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [showRerunMenu, setShowRerunMenu] = useState(false);
  const [showComparison, setShowComparison] = useState(false);
  const [showCopilot, setShowCopilot] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [rcaHistory, setRcaHistory] = useState<RCAHistory[]>([]);
  const [analysisProgress, setAnalysisProgress] = useState<string[]>([]);

  const toggle = (list: string[], setList: (v: string[]) => void, item: string) => {
    setList(list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);
  };

  const runAnalysis = async (analysisType: string = 'full') => {
    setLoading(true);
    setAnalysisProgress([]);
    
    // Simulate progress
    const steps = [
      'Collecting telemetry...',
      'Analyzing dependencies...',
      'Correlating incidents...',
      'Generating RCA...',
      'Completed'
    ];
    
    for (let i = 0; i < steps.length; i++) {
      setAnalysisProgress(prev => [...prev, steps[i]]);
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    try {
      const r = await analyzeRCA({ alerts, symptoms, service, time_window_hours: timeWindow });
      
      // Save previous result for comparison
      if (result) {
        setPreviousResult(result);
        setShowComparison(true);
      }
      
      setResult(r);
      
      // Add to history
      const newHistory: RCAHistory = {
        timestamp: new Date().toLocaleTimeString(),
        user: 'ops-engineer',
        version: 'v2.3',
        rootCause: r.root_cause_candidates[0]?.root_cause || 'Unknown',
        confidence: r.root_cause_candidates[0]?.confidence || 0,
        analysisType,
      };
      setRcaHistory(prev => [newHistory, ...prev].slice(0, 5));
    } finally {
      setLoading(false);
      setAnalysisProgress([]);
    }
  };

  const handleSearch = async (query: string) => {
    setSearchQuery(query);
    if (query.length < 2) {
      setSearchResults([]);
      setShowSearchResults(false);
      return;
    }

    // Mock search results - in production, call search API
    const mockResults: SearchResult[] = [
      {
        type: 'incident' as const,
        id: 'INC-1023',
        title: 'Database connection timeout',
        subtitle: 'Payment Authorization Service',
        relevance: 95,
      },
      {
        type: 'incident' as const,
        id: 'INC-1044',
        title: 'PostgreSQL saturation',
        subtitle: 'Settlement Processing',
        relevance: 87,
      },
      {
        type: 'rca' as const,
        id: 'RCA-2024-03-15',
        title: 'Database Connection Pool Exhaustion',
        subtitle: '91% confidence',
        relevance: 82,
      },
      {
        type: 'service' as const,
        id: 'settlement-processing',
        title: 'Settlement Processing',
        subtitle: 'Warning state',
        relevance: 75,
      },
    ].filter(r =>
      r.title.toLowerCase().includes(query.toLowerCase()) ||
      r.subtitle?.toLowerCase().includes(query.toLowerCase())
    );

    setSearchResults(mockResults);
    setShowSearchResults(true);
  };

  const similarRCACases = [
    {
      incidentId: 'INC-0987',
      rootCause: 'Database Connection Pool Exhaustion',
      resolution: 'Increased pool size from 100 to 200',
      timeToRecovery: '45 minutes',
      confidence: 89,
    },
    {
      incidentId: 'INC-0856',
      rootCause: 'PostgreSQL Query Timeout',
      resolution: 'Added missing index on transactions table',
      timeToRecovery: '2 hours',
      confidence: 84,
    },
    {
      incidentId: 'INC-0723',
      rootCause: 'Connection Leak in Application Code',
      resolution: 'Fixed connection handling in payment service',
      timeToRecovery: '3 hours',
      confidence: 78,
    },
  ];

  const copilotQuestions = [
    'Why was this identified as the root cause?',
    'What changed after the last deployment?',
    'Show all affected services',
    'Suggest alternative hypotheses',
    'What is the confidence breakdown?',
  ];

  return (
    <div>
      <PageHeader
        title="Root Cause Analysis - Investigation Workspace"
        description="Interactive RCA with search, re-run, comparison, and AI assistance"
      />

      {/* Global Search Bar */}
      <div className="mb-6 relative">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            onFocus={() => searchResults.length > 0 && setShowSearchResults(true)}
            placeholder="Search incidents, services, logs, traces, alerts, deployments, or RCA findings..."
            className="w-full pl-10 pr-4 py-3 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        {/* Search Results Dropdown */}
        {showSearchResults && searchResults.length > 0 && (
          <div className="absolute z-10 w-full mt-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl max-h-96 overflow-y-auto">
            <div className="p-2">
              <p className="text-xs text-slate-500 dark:text-slate-400 px-2 py-1">
                Found {searchResults.length} results
              </p>
              {searchResults.map((result) => (
                <Link
                  key={result.id}
                  to={`/${result.type}s/${result.id}`}
                  className="block p-3 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg transition-colors"
                  onClick={() => setShowSearchResults(false)}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-slate-900 dark:text-white">{result.title}</p>
                      {result.subtitle && (
                        <p className="text-xs text-slate-500 dark:text-slate-400">{result.subtitle}</p>
                      )}
                    </div>
                    <span className="text-xs px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded">
                      {result.type}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Left Panel - Input & Controls */}
        <div className="space-y-4">
          <div className="p-4 bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">Input Signals</h3>
            <p className={`text-xs ${textMuted} mb-2`}>Alerts</p>
            <div className="flex flex-wrap gap-1 mb-4">
              {ALERT_OPTIONS.map((a) => (
                <button
                  key={a}
                  onClick={() => toggle(alerts, setAlerts, a)}
                  className={`text-[10px] px-2 py-1 rounded border ${alerts.includes(a) ? 'bg-red-100 dark:bg-red-600/30 border-red-400 dark:border-red-500 text-red-800 dark:text-red-300' : 'border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-400 bg-white dark:bg-transparent'}`}
                >
                  {a}
                </button>
              ))}
            </div>
            <p className={`text-xs ${textMuted} mb-2`}>Symptoms</p>
            <div className="flex flex-wrap gap-1 mb-4">
              {SYMPTOM_OPTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => toggle(symptoms, setSymptoms, s)}
                  className={`text-[10px] px-2 py-1 rounded border ${symptoms.includes(s) ? 'bg-amber-100 dark:bg-yellow-600/30 border-amber-400 dark:border-yellow-500 text-amber-900 dark:text-yellow-300' : 'border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-400 bg-white dark:bg-transparent'}`}
                >
                  {s}
                </button>
              ))}
            </div>
            <label className={`text-xs ${textMuted}`}>Service</label>
            <select
              value={service}
              onChange={(e) => setService(e.target.value)}
              className={`w-full mt-1 mb-3 ${selectClass}`}
            >
              {SERVICES.map((s) => <option key={s} value={s}>{s.replace(/-/g, ' ')}</option>)}
            </select>
            <label className={`text-xs ${textMuted}`}>Time window (hours)</label>
            <input
              type="number"
              value={timeWindow}
              onChange={(e) => setTimeWindow(Number(e.target.value))}
              className={`w-full mt-1 mb-4 ${inputClass}`}
            />
            
            {/* Re-Run RCA with Dropdown */}
            <div className="relative">
              <div className="flex gap-2">
                <button
                  onClick={() => runAnalysis('full')}
                  disabled={loading}
                  className={`flex-1 py-2.5 ${btnPrimary} font-medium flex items-center justify-center gap-2`}
                >
                  <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                  {loading ? 'Analyzing...' : 'Run RCA Analysis'}
                </button>
                <button
                  onClick={() => setShowRerunMenu(!showRerunMenu)}
                  className="px-3 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                >
                  <ChevronDown className="w-4 h-4" />
                </button>
              </div>

              {/* Dropdown Menu */}
              {showRerunMenu && (
                <div className="absolute z-10 w-full mt-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl">
                  {[
                    { id: 'full', label: 'Full RCA', icon: RefreshCw },
                    { id: 'logs', label: 'Logs Only', icon: AlertCircle },
                    { id: 'traces', label: 'Traces Only', icon: TrendingUp },
                    { id: 'metrics', label: 'Metrics Only', icon: Activity },
                    { id: 'dependency', label: 'Dependency Analysis', icon: Zap },
                  ].map((option) => (
                    <button
                      key={option.id}
                      onClick={() => {
                        runAnalysis(option.id);
                        setShowRerunMenu(false);
                      }}
                      className="w-full px-4 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2 first:rounded-t-lg last:rounded-b-lg"
                    >
                      <option.icon className="w-4 h-4 text-slate-500" />
                      {option.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Analysis Progress */}
            {loading && analysisProgress.length > 0 && (
              <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                <div className="space-y-2">
                  {analysisProgress.map((step, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-xs">
                      {idx === analysisProgress.length - 1 && step !== 'Completed' ? (
                        <div className="w-3 h-3 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <CheckCircle className="w-3 h-3 text-green-600" />
                      )}
                      <span className="text-slate-700 dark:text-slate-300">{step}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* RCA History / Audit Trail */}
          {rcaHistory.length > 0 && (
            <div className="p-4 bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl">
              <div className="flex items-center gap-2 mb-3">
                <History className="w-4 h-4 text-slate-600 dark:text-slate-400" />
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">RCA History</h3>
              </div>
              <div className="space-y-2">
                {rcaHistory.map((h, idx) => (
                  <div key={idx} className="p-2 bg-slate-50 dark:bg-slate-900/50 rounded text-xs">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-slate-600 dark:text-slate-400">{h.timestamp}</span>
                      <span className="text-blue-600 dark:text-blue-400 font-mono">{h.version}</span>
                    </div>
                    <p className="text-slate-900 dark:text-white font-medium truncate">{h.rootCause}</p>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-slate-500 dark:text-slate-400">{h.analysisType}</span>
                      <span className="text-green-600 dark:text-green-400 font-bold">{h.confidence}%</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Similar RCA Cases */}
          <div className="p-4 bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">Similar RCA Cases</h3>
            <div className="space-y-3">
              {similarRCACases.map((rca) => (
                <div key={rca.incidentId} className="p-3 bg-slate-50 dark:bg-slate-900/50 rounded-lg">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-mono text-blue-600 dark:text-blue-400">{rca.incidentId}</span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">{rca.confidence}%</span>
                  </div>
                  <p className="text-xs font-medium text-slate-900 dark:text-white mb-1">{rca.rootCause}</p>
                  <p className="text-xs text-slate-600 dark:text-slate-400 mb-1">{rca.resolution}</p>
                  <div className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                    <Clock className="w-3 h-3" />
                    <span>TTR: {rca.timeToRecovery}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Main Content - RCA Results */}
        <div className="xl:col-span-2 space-y-4">
          {!result ? (
            <div className={emptyState}>
              Select alerts and symptoms, then run analysis
            </div>
          ) : (
            <>
              {/* Comparison View */}
              {showComparison && previousResult && (
                <div className="p-4 bg-gradient-to-r from-purple-50 to-blue-50 dark:from-purple-950/20 dark:to-blue-950/20 border border-purple-200 dark:border-purple-800 rounded-xl">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <GitCompare className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-white">RCA Comparison</h3>
                    </div>
                    <button
                      onClick={() => setShowComparison(false)}
                      className="text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                    >
                      Hide
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs text-slate-600 dark:text-slate-400 mb-1">Previous Root Cause</p>
                      <p className="text-sm font-medium text-slate-900 dark:text-white">
                        {previousResult.root_cause_candidates[0]?.root_cause}
                      </p>
                      <p className="text-xs text-slate-500 mt-1">
                        {previousResult.root_cause_candidates[0]?.confidence}% confidence
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-600 dark:text-slate-400 mb-1">Current Root Cause</p>
                      <p className="text-sm font-medium text-slate-900 dark:text-white">
                        {result.root_cause_candidates[0]?.root_cause}
                      </p>
                      <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                        {result.root_cause_candidates[0]?.confidence}% confidence
                        {result.root_cause_candidates[0]?.confidence > (previousResult.root_cause_candidates[0]?.confidence || 0) && ' ↗'}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 pt-3 border-t border-purple-200 dark:border-purple-800">
                    <p className="text-xs text-slate-600 dark:text-slate-400">
                      <strong>New Evidence:</strong> {result.similar_historical_incidents.length - previousResult.similar_historical_incidents.length} additional incidents detected
                    </p>
                  </div>
                </div>
              )}

              {/* AI RCA Copilot */}
              <div className="p-4 bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-950/20 dark:to-indigo-950/20 border border-blue-200 dark:border-blue-800 rounded-xl">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Brain className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white">AI RCA Assistant</h3>
                  </div>
                  <button
                    onClick={() => setShowCopilot(!showCopilot)}
                    className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    {showCopilot ? 'Hide' : 'Show'}
                  </button>
                </div>
                {showCopilot && (
                  <div className="space-y-2">
                    <p className="text-xs text-slate-600 dark:text-slate-400 mb-2">Ask the AI assistant:</p>
                    {copilotQuestions.map((q) => (
                      <button
                        key={q}
                        className="w-full text-left p-2 bg-white dark:bg-slate-900/50 hover:bg-blue-50 dark:hover:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded text-xs text-slate-700 dark:text-slate-300 transition-colors"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Root Cause Candidates */}
              <div className="p-4 bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-4">Root Cause Candidates</h3>
                <div className="space-y-4">
                  {result.root_cause_candidates.map((c, i) => (
                    <div key={c.root_cause} className="p-3 bg-slate-100 dark:bg-slate-900/50 rounded-lg">
                      <div className="flex items-center gap-3 mb-2">
                        <span className="text-lg font-bold text-slate-500">#{i + 1}</span>
                        <span className="text-sm font-semibold text-slate-900 dark:text-white flex-1">{c.root_cause}</span>
                        <span className={`text-lg font-bold ${textLink}`}>{c.confidence}%</span>
                      </div>
                      <ConfidenceBar value={c.confidence} />
                      <p className="text-xs text-slate-500 mt-2">
                        {c.matching_incident_count} matching incidents · Fixes: {c.suggested_fixes.join(', ')}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Rest of the existing content */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-2">Suggested Fix Playbook</h3>
                  <TagList items={result.suggested_fix_playbook} color="yellow" />
                </div>
                <div className="p-4 bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-2">Dependency Path</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {result.dependency_path.length > 0
                      ? result.dependency_path.join(' → ')
                      : 'No path found'}
                  </p>
                  {result.suspected_component && (
                    <p className={`text-xs ${textAccent} mt-2`}>Suspected: {result.suspected_component}</p>
                  )}
                </div>
                <div className="p-4 bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-2">Related Alerts to Check</h3>
                  <TagList items={result.related_alerts_to_check} color="red" />
                </div>
                <div className="p-4 bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-2">Related Symptoms to Check</h3>
                  <TagList items={result.related_symptoms_to_check} color="yellow" />
                </div>
              </div>

              <div className="p-4 bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">Similar Historical Incidents</h3>
                <div className="space-y-2">
                  {result.similar_historical_incidents.map((inc) => (
                    <Link
                      key={inc.incident_id}
                      to={`/incidents?id=${inc.incident_id}`}
                      className="flex justify-between text-xs p-2 bg-slate-100 dark:bg-slate-900/50 rounded hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
                    >
                      <span className={`${textLink} font-mono`}>{inc.incident_id}</span>
                      <span className="text-slate-700 dark:text-slate-300 flex-1 mx-3 truncate">{inc.title}</span>
                      <span className={textDanger}>{inc.root_cause}</span>
                    </Link>
                  ))}
                </div>
              </div>

              <div className="p-4 bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-2">Relevant Recent Changes</h3>
                {result.relevant_recent_changes.map((c) => (
                  <div key={c.id} className="flex justify-between text-xs py-1.5 border-b border-slate-100 dark:border-slate-800">
                    <span className="text-slate-700 dark:text-slate-300">{c.title}</span>
                    <span className={`${c.risk === 'high' ? textDanger : textMuted}`}>{c.risk}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Made with Bob
