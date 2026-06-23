import { useState, useEffect, useCallback } from 'react';
import {
  Cloud, Trash2, RefreshCw, CheckCircle2, XCircle,
  AlertTriangle, ChevronDown, ChevronUp, Server,
  Box, Layers, Wifi, WifiOff, Loader2, Eye, EyeOff,
  Activity, FileText, GitBranch, ShieldCheck, Key,
  Database, Zap, Radio, Clock, Filter, Search,
  BarChart2, Terminal, BookOpen, AlertOctagon
} from 'lucide-react';

const API = 'http://localhost:8000';

// ─── Types ────────────────────────────────────────────────────────────────────

type Provider = 'aws' | 'azure' | 'gcp' | 'kubernetes';
type TelemetryTab = 'connect' | 'resources' | 'logs' | 'traces' | 'audit' | 'compliance';

interface Connection {
  connection_id: string;
  provider: Provider;
  connection_name?: string;
  region?: string;
  subscription_id?: string;
  project_id?: string;
}

interface Resource {
  id: string;
  name: string;
  resource_type: string;
  provider: Provider;
  region: string;
  health: 'healthy' | 'warning' | 'critical';
}

interface LogEvent {
  log_group: string;
  log_stream: string;
  message: string;
  timestamp: string;
  source: string;
  region: string;
}

interface TraceItem {
  trace_id: string;
  duration_ms: number;
  has_error: boolean;
  has_fault: boolean;
  has_throttle: boolean;
  http_status?: number;
  http_url: string;
  root_service: string;
  services: string[];
  timestamp: string;
}

interface AuditEvent {
  event_id: string;
  event_name: string;
  event_source: string;
  username: string;
  source_ip: string;
  severity: string;
  resources: { type: string; name: string }[];
  timestamp: string;
}

interface ConfigRule {
  rule_name: string;
  description: string;
  is_compliant: boolean;
  state: string;
  source_identifier: string;
}

// ─── Provider brand config ─────────────────────────────────────────────────────

const PROVIDER_CONFIG: Record<Provider, { label: string; color: string; bg: string; border: string }> = {
  aws: { label: 'Amazon AWS', color: '#FF9900', bg: 'rgba(255,153,0,0.08)', border: 'rgba(255,153,0,0.25)' },
  azure: { label: 'Microsoft Azure', color: '#0078D4', bg: 'rgba(0,120,212,0.08)', border: 'rgba(0,120,212,0.25)' },
  gcp: { label: 'Google Cloud', color: '#4285F4', bg: 'rgba(66,133,244,0.08)', border: 'rgba(66,133,244,0.25)' },
  kubernetes: { label: 'Kubernetes', color: '#326CE5', bg: 'rgba(50,108,229,0.08)', border: 'rgba(50,108,229,0.25)' },
};

const RESOURCE_TYPE_ICON: Record<string, string> = {
  ec2_instance: '🖥️', eks_cluster: '⎈', rds_instance: '🗄️', load_balancer: '⚖️',
  ecs_cluster: '📦', ecs_service: '🐳', kinesis_stream: '🌊', event_bus: '📡',
  event_rule: '📋', eks_node: '🖧',
  azure_vm: '🖥️', aks_cluster: '⎈', azure_sql: '🗄️',
  gce_instance: '🖥️', gke_cluster: '⎈', cloud_sql: '🗄️',
  k8s_pod: '📦', k8s_node: '🖧', k8s_deployment: '🚀', k8s_service: '🔗',
  k8s_namespace: '📁', k8s_ingress: '🌐',
};

// AWS data sources shown in architecture diagram
const AWS_DATA_SOURCES = [
  { id: 'cloudwatch', label: 'CloudWatch', sub: 'Metrics + Alarms', icon: BarChart2, color: '#FF9900' },
  { id: 'container_insights', label: 'Container Insights', sub: 'ECS/EKS metrics', icon: Database, color: '#FF9900' },
  { id: 'xray', label: 'X-Ray', sub: 'Distributed traces', icon: GitBranch, color: '#FF9900' },
  { id: 'adot', label: 'ADOT', sub: 'OTel collector', icon: Activity, color: '#FF9900' },
  { id: 'cw_logs', label: 'CloudWatch Logs', sub: 'App + system logs', icon: FileText, color: '#FF9900' },
  { id: 'vpc_flow', label: 'VPC Flow Logs', sub: 'Network traffic', icon: Radio, color: '#FF9900' },
  { id: 'cloudtrail', label: 'CloudTrail', sub: 'Audit + API events', icon: BookOpen, color: '#FF9900' },
  { id: 'aws_config', label: 'AWS Config', sub: 'Config changes', icon: ShieldCheck, color: '#FF9900' },
  { id: 'kinesis', label: 'Kinesis Streams', sub: 'Real-time transport', icon: Zap, color: '#FF9900' },
  { id: 'eventbridge', label: 'EventBridge', sub: 'Event routing', icon: Terminal, color: '#FF9900' },
  { id: 'iam', label: 'IAM Access Key', sub: 'Single API key auth', icon: Key, color: '#FF9900' },
];

// Azure data sources shown in architecture diagram
const AZURE_DATA_SOURCES = [
  { id: 'azure_monitor', label: 'Azure Monitor', sub: 'Metrics + alerts', icon: BarChart2, color: '#0078D4' },
  { id: 'container_insights', label: 'Container Insights', sub: 'AKS / ACI metrics', icon: Database, color: '#0078D4' },
  { id: 'app_insights', label: 'App Insights', sub: 'Distributed traces', icon: GitBranch, color: '#0078D4' },
  { id: 'ama_otel', label: 'AMA + OTel', sub: 'OTel collector', icon: Activity, color: '#0078D4' },
  { id: 'log_analytics', label: 'Log Analytics', sub: 'App + system logs', icon: FileText, color: '#0078D4' },
  { id: 'nsg_flow', label: 'NSG Flow Logs', sub: 'Network traffic', icon: Radio, color: '#0078D4' },
  { id: 'activity_log', label: 'Activity Log', sub: 'Audit + API events', icon: BookOpen, color: '#0078D4' },
  { id: 'azure_policy', label: 'Azure Policy', sub: 'Config changes', icon: ShieldCheck, color: '#0078D4' },
  { id: 'event_hubs', label: 'Event Hubs', sub: 'Real-time log transport', icon: Zap, color: '#0078D4' },
  { id: 'event_grid', label: 'Event Grid', sub: 'Event routing', icon: Terminal, color: '#0078D4' },
  { id: 'service_principal', label: 'Service Principal', sub: 'App registration auth', icon: Key, color: '#0078D4' },
];

// GCP data sources shown in architecture diagram
const GCP_DATA_SOURCES = [
  { id: 'cloud_monitoring', label: 'Cloud Monitoring', sub: 'Metrics + alerts', icon: BarChart2, color: '#4285F4' },
  { id: 'gke_metrics', label: 'GKE / GCE Metrics', sub: 'Kubernetes monitoring', icon: Database, color: '#4285F4' },
  { id: 'cloud_trace', label: 'Cloud Trace', sub: 'Distributed traces', icon: GitBranch, color: '#4285F4' },
  { id: 'gcp_otel', label: 'OTel Collector', sub: 'OTel integration', icon: Activity, color: '#4285F4' },
  { id: 'cloud_logging', label: 'Cloud Logging', sub: 'App + system logs', icon: FileText, color: '#4285F4' },
  { id: 'vpc_flow', label: 'VPC Flow Logs', sub: 'Network traffic', icon: Radio, color: '#4285F4' },
  { id: 'cloud_audit', label: 'Cloud Audit Logs', sub: 'Audit + API events', icon: BookOpen, color: '#4285F4' },
  { id: 'asset_inventory', label: 'Cloud Asset Inventory', sub: 'Asset tracking & compliance', icon: ShieldCheck, color: '#4285F4' },
  { id: 'pubsub', label: 'Cloud Pub/Sub', sub: 'Real-time log transport', icon: Zap, color: '#4285F4' },
  { id: 'eventarc', label: 'Eventarc', sub: 'Event routing', icon: Terminal, color: '#4285F4' },
  { id: 'service_account', label: 'Service Account Key', sub: 'JSON key file auth', icon: Key, color: '#4285F4' },
];

// ─── API helpers ──────────────────────────────────────────────────────────────

async function apiFetch(path: string, options?: RequestInit) {
  const res = await fetch(`${API}${path}`, options);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || res.statusText);
  }
  return res.json();
}

// ─── Reusable form components ─────────────────────────────────────────────────

function FormField({ label, value, onChange, placeholder, required, secret }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; required?: boolean; secret?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <div>
      <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">{label}</label>
      <div className="relative">
        <input
          type={secret && !show ? 'password' : 'text'}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          required={required}
          className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-primary)] transition-colors placeholder:text-[var(--color-text-secondary)]/50"
        />
        {secret && (
          <button type="button" onClick={() => setShow(s => !s)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-secondary)]">
            {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>
    </div>
  );
}

function FormActions({ loading, error, label }: { loading: boolean; error: string; label: string }) {
  return (
    <>
      {error && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400">
          <XCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          {error}
        </div>
      )}
      <button
        type="submit"
        disabled={loading}
        className="w-full py-2 rounded-lg bg-[var(--color-primary)] text-white text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Validating & Connecting...</> : label}
      </button>
    </>
  );
}

// ─── AWS Form (with IAM Access Key + Role ARN tabs) ───────────────────────────

function AWSForm({ onSuccess }: { onSuccess: () => void }) {
  const [authMode, setAuthMode] = useState<'access_key' | 'role_arn' | 'default'>('access_key');
  const [form, setForm] = useState({
    connection_name: '', region: 'us-east-1',
    access_key_id: '', secret_access_key: '', session_token: '',
    role_arn: '', external_id: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      const body: Record<string, string> = { connection_name: form.connection_name, region: form.region };
      if (authMode === 'access_key') {
        body.access_key_id = form.access_key_id;
        body.secret_access_key = form.secret_access_key;
        if (form.session_token) body.session_token = form.session_token;
      } else if (authMode === 'role_arn') {
        body.role_arn = form.role_arn;
        if (form.external_id) body.external_id = form.external_id;
      }
      await apiFetch('/api/integrations/aws/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      onSuccess();
    } catch (err: any) { setError(err.message); }
    finally { setLoading(false); }
  };

  const authModes = [
    { id: 'access_key' as const, label: '🔑 Access Key', sub: 'IAM Access Key + Secret' },
    { id: 'role_arn' as const, label: '🎭 Role ARN', sub: 'STS AssumeRole' },
    { id: 'default' as const, label: '⚙️ Default', sub: 'Instance Profile / Env' },
  ];

  return (
    <form onSubmit={submit} className="space-y-3">
      <FormField label="Connection Name *" value={form.connection_name} onChange={v => setForm(p => ({ ...p, connection_name: v }))} placeholder="e.g. prod-aws" required />
      <FormField label="Region" value={form.region} onChange={v => setForm(p => ({ ...p, region: v }))} placeholder="us-east-1" />

      {/* Auth mode selector */}
      <div>
        <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-2">Authentication Method</label>
        <div className="grid grid-cols-3 gap-2">
          {authModes.map(m => (
            <button key={m.id} type="button" onClick={() => setAuthMode(m.id)}
              className={`py-2 px-2 rounded-lg border text-center transition-all ${authMode === m.id ? 'border-[#FF9900] bg-[#FF9900]/10 text-[#FF9900]' : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-card-hover)]'}`}>
              <p className="text-xs font-semibold">{m.label}</p>
              <p className="text-[10px] opacity-70 mt-0.5">{m.sub}</p>
            </button>
          ))}
        </div>
      </div>

      {authMode === 'access_key' && (
        <>
          <FormField label="Access Key ID *" value={form.access_key_id} onChange={v => setForm(p => ({ ...p, access_key_id: v }))} placeholder="AKIAIOSFODNN7EXAMPLE" required />
          <FormField label="Secret Access Key *" value={form.secret_access_key} onChange={v => setForm(p => ({ ...p, secret_access_key: v }))} placeholder="wJalrXUtnFEMI/K7MDENG..." required secret />
          <FormField label="Session Token (optional)" value={form.session_token} onChange={v => setForm(p => ({ ...p, session_token: v }))} placeholder="For temporary credentials only" secret />
        </>
      )}

      {authMode === 'role_arn' && (
        <div className="grid grid-cols-2 gap-3">
          <FormField label="IAM Role ARN *" value={form.role_arn} onChange={v => setForm(p => ({ ...p, role_arn: v }))} placeholder="arn:aws:iam::123456789012:role/MyRole" required />
          <FormField label="External ID (optional)" value={form.external_id} onChange={v => setForm(p => ({ ...p, external_id: v }))} placeholder="optional" />
        </div>
      )}

      {authMode === 'default' && (
        <div className="p-3 rounded-lg bg-[var(--color-card-hover)] border border-[var(--color-border)] text-xs text-[var(--color-text-secondary)]">
          <p className="font-semibold text-[var(--color-text-primary)] mb-1">Default Credential Chain</p>
          <p>Will use: AWS env vars → ~/.aws/credentials → EC2 instance profile → ECS task role</p>
        </div>
      )}

      <FormActions loading={loading} error={error} label="Connect AWS" />
    </form>
  );
}

// ─── Azure Form ───────────────────────────────────────────────────────────────

function AzureForm({ onSuccess }: { onSuccess: () => void }) {
  const [form, setForm] = useState({ connection_name: '', tenant_id: '', client_id: '', client_secret: '', subscription_id: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showSecret, setShowSecret] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      await apiFetch('/api/integrations/azure/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      onSuccess();
    } catch (err: any) { setError(err.message); }
    finally { setLoading(false); }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <FormField label="Connection Name *" value={form.connection_name} onChange={v => setForm(p => ({ ...p, connection_name: v }))} placeholder="e.g. prod-azure" required />
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Tenant ID *" value={form.tenant_id} onChange={v => setForm(p => ({ ...p, tenant_id: v }))} placeholder="xxxxxxxx-xxxx-xxxx-xxxx" required />
        <FormField label="Subscription ID *" value={form.subscription_id} onChange={v => setForm(p => ({ ...p, subscription_id: v }))} placeholder="xxxxxxxx-xxxx-xxxx-xxxx" required />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Client ID (App ID) *" value={form.client_id} onChange={v => setForm(p => ({ ...p, client_id: v }))} placeholder="xxxxxxxx-xxxx-xxxx-xxxx" required />
        <div>
          <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Client Secret *</label>
          <div className="relative">
            <input
              type={showSecret ? 'text' : 'password'}
              value={form.client_secret}
              onChange={e => setForm(p => ({ ...p, client_secret: e.target.value }))}
              placeholder="Your client secret"
              required
              className="w-full px-3 py-2 pr-9 text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-primary)] transition-colors"
            />
            <button type="button" onClick={() => setShowSecret(s => !s)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">
              {showSecret ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
      </div>
      <FormActions loading={loading} error={error} label="Connect Azure" />
    </form>
  );
}

// ─── GCP Form ─────────────────────────────────────────────────────────────────

function GCPForm({ onSuccess }: { onSuccess: () => void }) {
  const [form, setForm] = useState({ connection_name: '', project_id: '', service_account_json: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [jsonError, setJsonError] = useState('');

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const text = ev.target?.result as string;
      try { JSON.parse(text); setForm(p => ({ ...p, service_account_json: text })); setJsonError(''); }
      catch { setJsonError('Invalid JSON file'); }
    };
    reader.readAsText(file);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.service_account_json) { setJsonError('Service account JSON is required'); return; }
    setLoading(true); setError('');
    try {
      const parsed = JSON.parse(form.service_account_json);
      await apiFetch('/api/integrations/gcp/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connection_name: form.connection_name, project_id: form.project_id || parsed.project_id, service_account_json: parsed }),
      });
      onSuccess();
    } catch (err: any) { setError(err.message); }
    finally { setLoading(false); }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <FormField label="Connection Name *" value={form.connection_name} onChange={v => setForm(p => ({ ...p, connection_name: v }))} placeholder="e.g. prod-gcp" required />
      <FormField label="Project ID" value={form.project_id} onChange={v => setForm(p => ({ ...p, project_id: v }))} placeholder="my-gcp-project (or auto-detected from JSON)" />
      <div>
        <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Service Account JSON *</label>
        <div className="border-2 border-dashed border-[var(--color-border)] rounded-lg p-4 text-center hover:border-[var(--color-primary)]/50 transition-colors">
          <input type="file" accept=".json" onChange={handleFile} className="hidden" id="gcp-json-upload" />
          <label htmlFor="gcp-json-upload" className="cursor-pointer">
            <Box className="h-6 w-6 mx-auto mb-1 text-[var(--color-text-secondary)]" />
            <p className="text-xs text-[var(--color-text-secondary)]">
              {form.service_account_json ? <span className="text-green-500 font-medium">✓ JSON loaded</span> : 'Click to upload service-account.json'}
            </p>
          </label>
        </div>
        {jsonError && <p className="text-xs text-red-400 mt-1">{jsonError}</p>}
      </div>
      <FormActions loading={loading} error={error} label="Connect GCP" />
    </form>
  );
}

// ─── K8s Form ─────────────────────────────────────────────────────────────────

function K8sForm({ onSuccess }: { onSuccess: () => void }) {
  const [mode, setMode] = useState<'kubeconfig' | 'token'>('kubeconfig');
  const [form, setForm] = useState({ connection_name: '', kubeconfig: '', endpoint: '', token: '', ca_cert: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const text = btoa(ev.target?.result as string);
      setForm(p => ({ ...p, kubeconfig: text }));
    };
    reader.readAsText(file);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      const body = mode === 'kubeconfig'
        ? { connection_name: form.connection_name, kubeconfig: form.kubeconfig }
        : { connection_name: form.connection_name, endpoint: form.endpoint, token: form.token, ca_cert: form.ca_cert };
      await apiFetch('/api/integrations/kubernetes/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      onSuccess();
    } catch (err: any) { setError(err.message); }
    finally { setLoading(false); }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <FormField label="Connection Name *" value={form.connection_name} onChange={v => setForm(p => ({ ...p, connection_name: v }))} placeholder="e.g. prod-k8s" required />
      <div className="flex gap-2">
        {(['kubeconfig', 'token'] as const).map(m => (
          <button key={m} type="button" onClick={() => setMode(m)}
            className={`flex-1 py-1.5 text-xs rounded-lg border transition-colors ${mode === m ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]' : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-card-hover)]'}`}>
            {m === 'kubeconfig' ? 'Upload kubeconfig' : 'Endpoint + Token'}
          </button>
        ))}
      </div>
      {mode === 'kubeconfig' ? (
        <div className="border-2 border-dashed border-[var(--color-border)] rounded-lg p-4 text-center hover:border-[var(--color-primary)]/50 transition-colors">
          <input type="file" accept=".yaml,.yml,.conf" onChange={handleFile} className="hidden" id="k8s-kubeconfig-upload" />
          <label htmlFor="k8s-kubeconfig-upload" className="cursor-pointer">
            <Layers className="h-6 w-6 mx-auto mb-1 text-[var(--color-text-secondary)]" />
            <p className="text-xs text-[var(--color-text-secondary)]">
              {form.kubeconfig ? <span className="text-green-500 font-medium">✓ kubeconfig loaded</span> : 'Click to upload kubeconfig file'}
            </p>
          </label>
        </div>
      ) : (
        <>
          <FormField label="Cluster Endpoint *" value={form.endpoint} onChange={v => setForm(p => ({ ...p, endpoint: v }))} placeholder="https://your-cluster:6443" required />
          <FormField label="Bearer Token *" value={form.token} onChange={v => setForm(p => ({ ...p, token: v }))} placeholder="eyJhbGciOiJSUzI1NiIs..." required secret />
          <FormField label="CA Certificate (optional, base64)" value={form.ca_cert} onChange={v => setForm(p => ({ ...p, ca_cert: v }))} placeholder="LS0tLS1CRUdJTi..." />
        </>
      )}
      <FormActions loading={loading} error={error} label="Connect Kubernetes" />
    </form>
  );
}

// ─── Provider Card ─────────────────────────────────────────────────────────────

function ProviderCard({ provider, connections, onRefresh }: {
  provider: Provider;
  connections: Connection[];
  onRefresh: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const cfg = PROVIDER_CONFIG[provider];

  const deleteConn = async (connId: string) => {
    setDeleting(connId);
    try {
      await apiFetch(`/api/integrations/connections/${connId}?provider=${provider}`, { method: 'DELETE' });
      onRefresh();
    } catch { }
    finally { setDeleting(null); }
  };

  return (
    <div className="rounded-xl border overflow-hidden transition-all duration-200" style={{ borderColor: cfg.border, background: cfg.bg }}>
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between px-5 py-4 text-left"
      >
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg flex items-center justify-center text-lg font-bold border" style={{ borderColor: cfg.border, background: 'var(--color-card)' }}>
            {provider === 'aws' ? '☁' : provider === 'azure' ? '⬡' : provider === 'gcp' ? '◈' : '⎈'}
          </div>
          <div>
            <p className="text-sm font-semibold text-[var(--color-text-primary)]">{cfg.label}</p>
            <p className="text-xs text-[var(--color-text-secondary)]">
              {connections.length === 0 ? 'No connections' : `${connections.length} connection${connections.length > 1 ? 's' : ''} active`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${connections.length > 0 ? 'bg-green-500/15 text-green-400' : 'bg-[var(--color-border)]/60 text-[var(--color-text-secondary)]'}`}>
            {connections.length > 0 ? 'CONNECTED' : 'NOT SET UP'}
          </span>
          {expanded ? <ChevronUp className="h-4 w-4 text-[var(--color-text-secondary)]" /> : <ChevronDown className="h-4 w-4 text-[var(--color-text-secondary)]" />}
        </div>
      </button>

      {expanded && (
        <div className="px-5 pb-5 space-y-4 border-t" style={{ borderColor: cfg.border }}>
          {connections.length > 0 && (
            <div className="space-y-2 pt-4">
              {connections.map(conn => (
                <div key={conn.connection_id} className="flex items-center justify-between p-3 rounded-lg bg-[var(--color-card)] border border-[var(--color-border)]">
                  <div className="flex items-center gap-2.5">
                    <CheckCircle2 className="h-4 w-4 text-green-400 shrink-0" />
                    <div>
                      <p className="text-xs font-semibold text-[var(--color-text-primary)]">{conn.connection_id}</p>
                      <p className="text-[10px] text-[var(--color-text-secondary)]">
                        {conn.region && `Region: ${conn.region}`}
                        {conn.subscription_id && `Subscription: ${conn.subscription_id.slice(0, 8)}…`}
                        {conn.project_id && `Project: ${conn.project_id}`}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => deleteConn(conn.connection_id)}
                    disabled={deleting === conn.connection_id}
                    className="h-7 w-7 rounded-lg flex items-center justify-center text-[var(--color-text-secondary)] hover:text-red-400 hover:bg-red-400/10 transition-colors"
                  >
                    {deleting === conn.connection_id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="pt-2">
            <p className="text-xs font-semibold text-[var(--color-text-secondary)] mb-3 uppercase tracking-wider">
              {connections.length > 0 ? 'Add Another Connection' : 'Add Connection'}
            </p>
            {provider === 'aws' && <AWSForm onSuccess={onRefresh} />}
            {provider === 'azure' && <AzureForm onSuccess={onRefresh} />}
            {provider === 'gcp' && <GCPForm onSuccess={onRefresh} />}
            {provider === 'kubernetes' && <K8sForm onSuccess={onRefresh} />}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── AWS Data Sources Panel ────────────────────────────────────────────────────

function AWSSourcesPanel({ hasConnection }: { hasConnection: boolean }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="rounded-xl border border-[#FF9900]/20 bg-[#FF9900]/5 overflow-hidden transition-all duration-200">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center gap-2 p-5 text-left hover:bg-[#FF9900]/10 transition-colors"
      >
        <Cloud className="h-4 w-4 text-[#FF9900]" />
        <p className="text-sm font-semibold text-[var(--color-text-primary)]">AWS Account — Data Sources</p>
        <div className="ml-auto flex items-center gap-3">
          {hasConnection
            ? <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-500/15 text-green-400">ACTIVE</span>
            : <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[var(--color-border)]/60 text-[var(--color-text-secondary)]">NOT CONNECTED</span>
          }
          {isOpen ? <ChevronUp className="h-4 w-4 text-[var(--color-text-secondary)]" /> : <ChevronDown className="h-4 w-4 text-[var(--color-text-secondary)]" />}
        </div>
      </button>
      {isOpen && (
        <div className="px-5 pb-5 border-t border-[#FF9900]/10 pt-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {AWS_DATA_SOURCES.map(src => {
              const Icon = src.icon;
              return (
                <div key={src.id} className={`flex items-start gap-2.5 p-2.5 rounded-lg border transition-all ${hasConnection ? 'border-[#FF9900]/20 bg-[#FF9900]/5' : 'border-[var(--color-border)] bg-[var(--color-card-hover)] opacity-50'}`}>
                  <div className={`h-7 w-7 rounded-lg flex items-center justify-center shrink-0 ${hasConnection ? 'bg-[#FF9900]/15' : 'bg-[var(--color-border)]/30'}`}>
                    <Icon className={`h-3.5 w-3.5 ${hasConnection ? 'text-[#FF9900]' : 'text-[var(--color-text-secondary)]'}`} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-[var(--color-text-primary)] truncate">{src.label}</p>
                    <p className="text-[10px] text-[var(--color-text-secondary)] truncate">{src.sub}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Azure Data Sources Panel ─────────────────────────────────────────────────

function AzureSourcesPanel({ hasConnection }: { hasConnection: boolean }) {
  const [isOpen, setIsOpen] = useState(false);
  // Track which sources are actually implemented vs planned
  const implemented = new Set([
    'azure_monitor', 'container_insights', 'ama_otel',
    'log_analytics', 'activity_log', 'service_principal',
  ]);

  return (
    <div className="rounded-xl border border-[#0078D4]/20 bg-[#0078D4]/5 overflow-hidden transition-all duration-200">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center gap-2 p-5 text-left hover:bg-[#0078D4]/10 transition-colors"
      >
        <span className="text-lg">⬡</span>
        <p className="text-sm font-semibold text-[var(--color-text-primary)]">Azure — Data Sources</p>
        <div className="ml-auto flex items-center gap-3">
          {hasConnection
            ? <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-500/15 text-green-400">ACTIVE</span>
            : <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[var(--color-border)]/60 text-[var(--color-text-secondary)]">NOT CONNECTED</span>
          }
          {isOpen ? <ChevronUp className="h-4 w-4 text-[var(--color-text-secondary)]" /> : <ChevronDown className="h-4 w-4 text-[var(--color-text-secondary)]" />}
        </div>
      </button>
      {isOpen && (
        <div className="px-5 pb-5 border-t border-[#0078D4]/10 pt-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {AZURE_DATA_SOURCES.map(src => {
              const Icon = src.icon;
              const isLive = implemented.has(src.id);
              return (
                <div
                  key={src.id}
                  className={`flex items-start gap-2.5 p-2.5 rounded-lg border transition-all relative ${hasConnection
                    ? isLive
                      ? 'border-[#0078D4]/20 bg-[#0078D4]/5'
                      : 'border-[var(--color-border)] bg-[var(--color-card-hover)] opacity-60'
                    : 'border-[var(--color-border)] bg-[var(--color-card-hover)] opacity-50'
                    }`}
                >
                  <div className={`h-7 w-7 rounded-lg flex items-center justify-center shrink-0 ${hasConnection && isLive ? 'bg-[#0078D4]/15' : 'bg-[var(--color-border)]/30'
                    }`}>
                    <Icon className={`h-3.5 w-3.5 ${hasConnection && isLive ? 'text-[#0078D4]' : 'text-[var(--color-text-secondary)]'
                      }`} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-[var(--color-text-primary)] truncate">{src.label}</p>
                    <p className="text-[10px] text-[var(--color-text-secondary)] truncate">{src.sub}</p>
                  </div>
                  {hasConnection && !isLive && (
                    <span className="absolute top-1.5 right-1.5 text-[8px] px-1 py-0.5 rounded bg-yellow-500/10 text-yellow-500 border border-yellow-500/20 font-bold leading-none">SOON</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function GCPSourcesPanel({ hasConnection }: { hasConnection: boolean }) {
  const [isOpen, setIsOpen] = useState(false);
  // Track which sources are actually implemented vs planned
  const implemented = new Set([
    'cloud_monitoring', 'gke_metrics', 'cloud_trace',
    'gcp_otel', 'cloud_logging', 'service_account',
  ]);

  return (
    <div className="rounded-xl border border-[#4285F4]/20 bg-[#4285F4]/5 overflow-hidden transition-all duration-200">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center gap-2 p-5 text-left hover:bg-[#4285F4]/10 transition-colors"
      >
        <span className="text-lg">◈</span>
        <p className="text-sm font-semibold text-[var(--color-text-primary)]">GCP — Data Sources</p>
        <div className="ml-auto flex items-center gap-3">
          {hasConnection
            ? <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-500/15 text-green-400">ACTIVE</span>
            : <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[var(--color-border)]/60 text-[var(--color-text-secondary)]">NOT CONNECTED</span>
          }
          {isOpen ? <ChevronUp className="h-4 w-4 text-[var(--color-text-secondary)]" /> : <ChevronDown className="h-4 w-4 text-[var(--color-text-secondary)]" />}
        </div>
      </button>
      {isOpen && (
        <div className="px-5 pb-5 border-t border-[#4285F4]/10 pt-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {GCP_DATA_SOURCES.map(src => {
              const Icon = src.icon;
              const isLive = implemented.has(src.id);
              return (
                <div
                  key={src.id}
                  className={`flex items-start gap-2.5 p-2.5 rounded-lg border transition-all relative ${hasConnection
                    ? isLive
                      ? 'border-[#4285F4]/20 bg-[#4285F4]/5'
                      : 'border-[var(--color-border)] bg-[var(--color-card-hover)] opacity-60'
                    : 'border-[var(--color-border)] bg-[var(--color-card-hover)] opacity-50'
                    }`}
                >
                  <div className={`h-7 w-7 rounded-lg flex items-center justify-center shrink-0 ${hasConnection && isLive ? 'bg-[#4285F4]/15' : 'bg-[var(--color-border)]/30'
                    }`}>
                    <Icon className={`h-3.5 w-3.5 ${hasConnection && isLive ? 'text-[#4285F4]' : 'text-[var(--color-text-secondary)]'
                      }`} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-[var(--color-text-primary)] truncate">{src.label}</p>
                    <p className="text-[10px] text-[var(--color-text-secondary)] truncate">{src.sub}</p>
                  </div>
                  {hasConnection && !isLive && (
                    <span className="absolute top-1.5 right-1.5 text-[8px] px-1 py-0.5 rounded bg-yellow-500/10 text-yellow-500 border border-yellow-500/20 font-bold leading-none">SOON</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Resources Panel ──────────────────────────────────────────────────────────

function ResourcesPanel({ activeProvider }: { activeProvider: Provider }) {
  const [resources, setResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    setLoading(true);
    const qs = `&provider=${activeProvider}`;
    apiFetch(`/api/integrations/resources?limit=500${qs}`)
      .then(d => setResources(d.resources || []))
      .catch(() => setResources([]))
      .finally(() => setLoading(false));
  }, [activeProvider]);

  const filtered = resources
    .filter(r => !search || r.name.toLowerCase().includes(search.toLowerCase()) || r.resource_type.includes(search.toLowerCase()));

  const byType = filtered.reduce((acc, r) => {
    acc[r.resource_type] = (acc[r.resource_type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const healthColor = (h: string) =>
    h === 'healthy' ? 'text-green-400 bg-green-400/10' :
      h === 'warning' ? 'text-yellow-400 bg-yellow-400/10' :
        'text-red-400 bg-red-400/10';

  if (loading) return (
    <div className="flex items-center justify-center py-12 text-[var(--color-text-secondary)]">
      <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading resources...
    </div>
  );

  if (resources.length === 0) return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <Server className="h-10 w-10 text-[var(--color-text-secondary)]/30 mb-3" />
      <p className="text-sm font-medium text-[var(--color-text-secondary)]">
        {`No ${PROVIDER_CONFIG[activeProvider].label} resources yet`}
      </p>
      <p className="text-xs text-[var(--color-text-secondary)]/60 mt-1 max-w-xs">
        Connect a cloud provider and click "Sync Now" to discover your infrastructure.
      </p>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex gap-3 items-center flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--color-text-secondary)]" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search resources..."
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-primary)]" />
        </div>
        <span className="text-xs text-[var(--color-text-secondary)]">{filtered.length} resources</span>
      </div>

      <div className="flex gap-2 flex-wrap">
        {Object.entries(byType).map(([type, count]) => (
          <span key={type} className="text-[10px] px-2 py-0.5 rounded bg-[var(--color-card-hover)] border border-[var(--color-border)] text-[var(--color-text-secondary)]">
            {RESOURCE_TYPE_ICON[type] || '📌'} {type.replace(/_/g, ' ')} · {count}
          </span>
        ))}
      </div>

      <div className="rounded-xl border border-[var(--color-border)] overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[var(--color-border)] bg-[var(--color-card-hover)]">
              <th className="px-4 py-2.5 text-left font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider text-[10px]">Resource</th>
              <th className="px-4 py-2.5 text-left font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider text-[10px]">Type</th>
              <th className="px-4 py-2.5 text-left font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider text-[10px]">Region</th>
              <th className="px-4 py-2.5 text-left font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider text-[10px]">Health</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border)]">
            {filtered.map(r => (
              <tr key={`${r.provider}::${r.id}`} className="hover:bg-[var(--color-card-hover)] transition-colors">
                <td className="px-4 py-2.5 font-medium text-[var(--color-text-primary)] max-w-[180px] truncate">{r.name}</td>
                <td className="px-4 py-2.5 text-[var(--color-text-secondary)]">
                  {RESOURCE_TYPE_ICON[r.resource_type] || '📌'} {r.resource_type.replace(/_/g, ' ')}
                </td>
                <td className="px-4 py-2.5 text-[var(--color-text-secondary)]">{r.region}</td>
                <td className="px-4 py-2.5">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${healthColor(r.health)}`}>
                    {r.health}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Logs Panel ───────────────────────────────────────────────────────────────

function LogsPanel({ activeProvider }: { activeProvider: Provider }) {
  const [data, setData] = useState<{ events: LogEvent[]; log_groups: any[]; updated_at: string }>({ events: [], log_groups: [], updated_at: '' });
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<'all' | 'cloudwatch_logs' | 'vpc_flow_logs'>('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    setLoading(true);
    const qs = `&provider=${activeProvider}`;
    apiFetch(`/api/integrations/logs?limit=200${qs}`)
      .then(d => setData(d))
      .catch(() => { })
      .finally(() => setLoading(false));
  }, [activeProvider]);

  const events = data.events
    .filter(e => source === 'all' || e.source === source)
    .filter(e => !search || e.message.toLowerCase().includes(search.toLowerCase()) || e.log_group.toLowerCase().includes(search.toLowerCase()));

  const severityColor = (msg: string) => {
    const m = msg.toLowerCase();
    if (m.includes('error') || m.includes('exception') || m.includes('critical')) return 'text-red-400 border-red-400/20 bg-red-400/5';
    if (m.includes('warn')) return 'text-yellow-400 border-yellow-400/20 bg-yellow-400/5';
    return 'text-[var(--color-text-secondary)] border-[var(--color-border)] bg-transparent';
  };

  if (loading) return <div className="flex items-center justify-center py-12 text-[var(--color-text-secondary)]"><Loader2 className="h-5 w-5 animate-spin mr-2" />Loading logs...</div>;

  if (data.events.length === 0) return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <FileText className="h-10 w-10 text-[var(--color-text-secondary)]/30 mb-3" />
      <p className="text-sm font-medium text-[var(--color-text-secondary)]">No log events collected yet</p>
      <p className="text-xs text-[var(--color-text-secondary)]/60 mt-1">CloudWatch Logs sync runs every 2 minutes after connection.</p>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex gap-3 items-center flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--color-text-secondary)]" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search messages..."
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-primary)]" />
        </div>
        {(['all', 'cloudwatch_logs', 'vpc_flow_logs'] as const).map(s => (
          <button key={s} onClick={() => setSource(s)}
            className={`px-3 py-1 text-xs rounded-full border transition-colors ${source === s ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]' : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-card-hover)]'}`}>
            {s === 'all' ? `All (${data.events.length})` : s === 'cloudwatch_logs' ? 'App Logs' : 'VPC Flow'}
          </button>
        ))}
      </div>
      <div className="space-y-1.5 max-h-[500px] overflow-y-auto pr-1">
        {events.slice(0, 100).map((ev, i) => (
          <div key={i} className={`rounded-lg border px-3 py-2 font-mono text-[11px] ${severityColor(ev.message)}`}>
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-[var(--color-text-secondary)] shrink-0">{new Date(ev.timestamp).toLocaleTimeString()}</span>
              <span className="text-[var(--color-primary)] truncate max-w-[200px]">{ev.log_group}</span>
              <span className="ml-auto shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-card-hover)]">{ev.source === 'vpc_flow_logs' ? '🌊 VPC' : '📋 CW'}</span>
            </div>
            <p className="truncate text-[var(--color-text-primary)]">{ev.message}</p>
          </div>
        ))}
      </div>
      {data.updated_at && <p className="text-[10px] text-[var(--color-text-secondary)]">Last updated: {new Date(data.updated_at).toLocaleString()}</p>}
    </div>
  );
}

// ─── Traces Panel ─────────────────────────────────────────────────────────────

function TracesPanel({ activeProvider }: { activeProvider: Provider }) {
  const [data, setData] = useState<{ traces: TraceItem[]; service_map: any[]; updated_at: string }>({ traces: [], service_map: [], updated_at: '' });
  const [otelStatus, setOtelStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'errors' | 'faults'>('all');
  const [showSetup, setShowSetup] = useState(false);
  const [setupLang, setSetupLang] = useState<'python' | 'node'>('python');

  useEffect(() => {
    setLoading(true);
    const qs = `&provider=${activeProvider}`;
    Promise.all([
      apiFetch(`/api/integrations/traces?limit=100${qs}`).catch(() => ({ traces: [], service_map: [], updated_at: '' })),
      apiFetch('/api/otel/status').catch(() => null)
    ])
      .then(([tracesData, otelData]) => {
        setData(tracesData);
        setOtelStatus(otelData);
      })
      .catch(() => { })
      .finally(() => setLoading(false));
  }, [activeProvider]);

  const traces = data.traces.filter(t =>
    filter === 'all' || (filter === 'errors' && t.has_error) || (filter === 'faults' && t.has_fault)
  );

  if (loading) return <div className="flex items-center justify-center py-12 text-[var(--color-text-secondary)]"><Loader2 className="h-5 w-5 animate-spin mr-2" />Loading traces...</div>;

  return (
    <div className="space-y-6">
      {/* OTel Receiver Status Card */}
      {otelStatus && (
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4 space-y-4">
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">OpenTelemetry OTLP/HTTP Receiver</h3>
                <span className="text-[10px] px-2 py-0.5 rounded bg-green-500/10 text-green-400 border border-green-500/20">Active</span>
              </div>
              <p className="text-xs text-[var(--color-text-secondary)]">
                Direct span ingestion endpoint: <code className="px-1.5 py-0.5 rounded bg-[var(--color-card-hover)] text-[var(--color-primary)] font-mono text-[10px]">http://localhost:8000/api/otel/v1/traces</code>
              </p>
            </div>
            <button
              onClick={() => setShowSetup(s => !s)}
              className="px-2.5 py-1 text-xs rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-card-hover)] transition-colors text-[var(--color-text-secondary)]"
            >
              {showSetup ? 'Hide Setup' : 'How to Instrument'}
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 rounded-lg bg-[var(--color-card-hover)] border border-[var(--color-border)]">
              <p className="text-[10px] text-[var(--color-text-secondary)] font-medium">Ingested Spans</p>
              <p className="text-lg font-bold text-[var(--color-text-primary)] mt-1">{otelStatus.spans_stored}</p>
            </div>
            <div className="p-3 rounded-lg bg-[var(--color-card-hover)] border border-[var(--color-border)]">
              <p className="text-[10px] text-[var(--color-text-secondary)] font-medium">OTel Services</p>
              <p className="text-lg font-bold text-[var(--color-text-primary)] mt-1">{otelStatus.topology?.otel_services || 0}</p>
            </div>
            <div className="p-3 rounded-lg bg-[var(--color-card-hover)] border border-[var(--color-border)]">
              <p className="text-[10px] text-[var(--color-text-secondary)] font-medium">Derived App Edges</p>
              <p className="text-lg font-bold text-[var(--color-text-primary)] mt-1">{otelStatus.topology?.otel_app_edges || 0}</p>
            </div>
            <div className="p-3 rounded-lg bg-[var(--color-card-hover)] border border-[var(--color-border)]">
              <p className="text-[10px] text-[var(--color-text-secondary)] font-medium">AWS Infra Edges</p>
              <p className="text-lg font-bold text-[var(--color-text-primary)] mt-1">
                {(otelStatus.topology?.infra_tier1_xray || 0) + (otelStatus.topology?.infra_tier2_structural || 0)}
              </p>
            </div>
          </div>

          {/* Setup dropdown instructions */}
          {showSetup && (
            <div className="p-4 rounded-lg bg-[var(--color-card-hover)] border border-[var(--color-border)] space-y-3">
              <div className="flex gap-2 border-b border-[var(--color-border)] pb-2">
                <button
                  type="button"
                  onClick={() => setSetupLang('python')}
                  className={`text-xs font-semibold pb-1 border-b-2 transition-colors ${setupLang === 'python' ? 'border-[var(--color-primary)] text-[var(--color-primary)]' : 'border-transparent text-[var(--color-text-secondary)]'}`}
                >
                  Python SDK
                </button>
                <button
                  type="button"
                  onClick={() => setSetupLang('node')}
                  className={`text-xs font-semibold pb-1 border-b-2 transition-colors ${setupLang === 'node' ? 'border-[var(--color-primary)] text-[var(--color-primary)]' : 'border-transparent text-[var(--color-text-secondary)]'}`}
                >
                  Node.js SDK
                </button>
              </div>
              <div className="space-y-2 text-xs">
                <p className="font-semibold text-[var(--color-text-primary)]">1. Set environment variables:</p>
                <pre className="p-2.5 rounded bg-[var(--color-background)] border border-[var(--color-border)] text-[var(--color-text-primary)] font-mono text-[10px] overflow-x-auto">
                  {`OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:8000/api/otel\nOTEL_EXPORTER_OTLP_PROTOCOL=http/json\nOTEL_SERVICE_NAME=my-service`}
                </pre>
                <p className="font-semibold text-[var(--color-text-primary)]">2. Code configuration example:</p>
                <pre className="p-2.5 rounded bg-[var(--color-background)] border border-[var(--color-border)] text-[var(--color-text-primary)] font-mono text-[10px] overflow-x-auto whitespace-pre-wrap">
                  {setupLang === 'python' ? otelStatus.sdk_setup?.python_example : otelStatus.sdk_setup?.node_example}
                </pre>
              </div>
            </div>
          )}

          {/* Active OTel Services tag list */}
          {otelStatus.services_seen && Object.keys(otelStatus.services_seen).length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] text-[var(--color-text-secondary)] uppercase font-semibold tracking-wider">Active reporting services</p>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(otelStatus.services_seen).map(([svc, count]) => (
                  <span key={svc} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-[var(--color-background)] border border-[var(--color-border)] text-[var(--color-text-primary)]">
                    <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                    {svc}
                    <span className="text-[10px] text-[var(--color-text-secondary)]">({count as any} spans)</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* X-Ray / AWS traces section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">AWS X-Ray Collected Traces</h4>
          {data.traces.length > 0 && (
            <div className="flex gap-2">
              {(['all', 'errors', 'faults'] as const).map(f => (
                <button key={f} onClick={() => setFilter(f)}
                  className={`px-3 py-1 text-xs rounded-full border transition-colors ${filter === f ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]' : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-card-hover)]'}`}>
                  {f === 'all' ? `All (${data.traces.length})` : f === 'errors' ? `Errors (${data.traces.filter(t => t.has_error).length})` : `Faults (${data.traces.filter(t => t.has_fault).length})`}
                </button>
              ))}
            </div>
          )}
        </div>

        {data.traces.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center rounded-xl border border-dashed border-[var(--color-border)]">
            <GitBranch className="h-8 w-8 text-[var(--color-text-secondary)]/30 mb-2" />
            <p className="text-xs font-medium text-[var(--color-text-secondary)]">No AWS X-Ray traces collected in this view</p>
            <p className="text-[10px] text-[var(--color-text-secondary)]/60 mt-0.5">Configure X-Ray in AWS. AWS Syncs every 1 minute.</p>
          </div>
        ) : (
          <div className="rounded-xl border border-[var(--color-border)] overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--color-border)] bg-[var(--color-card-hover)]">
                  <th className="px-4 py-2.5 text-left font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider text-[10px]">Trace ID</th>
                  <th className="px-4 py-2.5 text-left font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider text-[10px]">Service</th>
                  <th className="px-4 py-2.5 text-left font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider text-[10px]">Duration</th>
                  <th className="px-4 py-2.5 text-left font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider text-[10px]">Status</th>
                  <th className="px-4 py-2.5 text-left font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider text-[10px]">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {traces.slice(0, 50).map(t => (
                  <tr key={t.trace_id} className="hover:bg-[var(--color-card-hover)] transition-colors">
                    <td className="px-4 py-2.5 font-mono text-[var(--color-text-secondary)] max-w-[120px] truncate">{t.trace_id.slice(0, 16)}…</td>
                    <td className="px-4 py-2.5 font-medium text-[var(--color-text-primary)]">{t.root_service}</td>
                    <td className="px-4 py-2.5 text-[var(--color-text-secondary)]">{t.duration_ms.toFixed(0)}ms</td>
                    <td className="px-4 py-2.5">
                      {t.has_fault ? <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-400/10 text-red-400">FAULT</span>
                        : t.has_error ? <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-orange-400/10 text-orange-400">ERROR</span>
                          : t.has_throttle ? <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-yellow-400/10 text-yellow-400">THROTTLE</span>
                            : <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-400/10 text-green-400">OK</span>}
                    </td>
                    <td className="px-4 py-2.5 text-[var(--color-text-secondary)]">{new Date(t.timestamp).toLocaleTimeString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Audit Events Panel ───────────────────────────────────────────────────────

function AuditPanel({ activeProvider }: { activeProvider: Provider }) {
  const [data, setData] = useState<{ events: AuditEvent[]; updated_at: string }>({ events: [], updated_at: '' });
  const [loading, setLoading] = useState(true);
  const [severity, setSeverity] = useState<'all' | 'critical' | 'warning' | 'info'>('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    setLoading(true);
    const qs = `&provider=${activeProvider}`;
    apiFetch(`/api/integrations/audit-events?limit=200${qs}`)
      .then(d => setData(d))
      .catch(() => { })
      .finally(() => setLoading(false));
  }, [activeProvider]);

  const events = data.events
    .filter(e => severity === 'all' || e.severity === severity)
    .filter(e => !search || e.event_name.toLowerCase().includes(search.toLowerCase()) || e.username.toLowerCase().includes(search.toLowerCase()));

  const sevColor = (s: string) =>
    s === 'critical' ? 'text-red-400 bg-red-400/10' :
      s === 'warning' ? 'text-yellow-400 bg-yellow-400/10' :
        'text-blue-400 bg-blue-400/10';

  if (loading) return <div className="flex items-center justify-center py-12 text-[var(--color-text-secondary)]"><Loader2 className="h-5 w-5 animate-spin mr-2" />Loading audit events...</div>;

  if (data.events.length === 0) return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <BookOpen className="h-10 w-10 text-[var(--color-text-secondary)]/30 mb-3" />
      <p className="text-sm font-medium text-[var(--color-text-secondary)]">No CloudTrail audit events yet</p>
      <p className="text-xs text-[var(--color-text-secondary)]/60 mt-1">Only write-only API calls are collected. Syncs every 5 minutes.</p>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex gap-3 items-center flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--color-text-secondary)]" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Filter by event or user..."
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-primary)]" />
        </div>
        {(['all', 'critical', 'warning', 'info'] as const).map(s => (
          <button key={s} onClick={() => setSeverity(s)}
            className={`px-3 py-1 text-xs rounded-full border transition-colors ${severity === s ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]' : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-card-hover)]'}`}>
            {s === 'all' ? `All (${data.events.length})` : s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>
      <div className="rounded-xl border border-[var(--color-border)] overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[var(--color-border)] bg-[var(--color-card-hover)]">
              <th className="px-4 py-2.5 text-left font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider text-[10px]">Event</th>
              <th className="px-4 py-2.5 text-left font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider text-[10px]">User</th>
              <th className="px-4 py-2.5 text-left font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider text-[10px]">Source IP</th>
              <th className="px-4 py-2.5 text-left font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider text-[10px]">Severity</th>
              <th className="px-4 py-2.5 text-left font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider text-[10px]">Time</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border)]">
            {events.slice(0, 100).map(e => (
              <tr key={e.event_id} className="hover:bg-[var(--color-card-hover)] transition-colors">
                <td className="px-4 py-2.5 font-medium text-[var(--color-text-primary)]">{e.event_name}</td>
                <td className="px-4 py-2.5 text-[var(--color-text-secondary)]">{e.username || '—'}</td>
                <td className="px-4 py-2.5 font-mono text-[var(--color-text-secondary)]">{e.source_ip || '—'}</td>
                <td className="px-4 py-2.5"><span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${sevColor(e.severity)}`}>{e.severity}</span></td>
                <td className="px-4 py-2.5 text-[var(--color-text-secondary)]">{new Date(e.timestamp).toLocaleTimeString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Compliance Panel ─────────────────────────────────────────────────────────

function CompliancePanel({ activeProvider }: { activeProvider: Provider }) {
  const [data, setData] = useState<{ rules: ConfigRule[]; non_compliant_resources: any[]; total_rules: number; non_compliant_rule_count: number; updated_at: string }>({
    rules: [], non_compliant_resources: [], total_rules: 0, non_compliant_rule_count: 0, updated_at: ''
  });
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'compliant' | 'non_compliant'>('all');

  useEffect(() => {
    setLoading(true);
    const qs = `provider=${activeProvider}`;
    apiFetch(`/api/integrations/config-compliance?${qs}`)
      .then(d => setData(d))
      .catch(() => { })
      .finally(() => setLoading(false));
  }, [activeProvider]);

  const rules = data.rules.filter(r =>
    filter === 'all' || (filter === 'compliant' && r.is_compliant) || (filter === 'non_compliant' && !r.is_compliant)
  );

  const complianceRate = data.total_rules > 0
    ? Math.round(((data.total_rules - data.non_compliant_rule_count) / data.total_rules) * 100)
    : 100;

  if (loading) return <div className="flex items-center justify-center py-12 text-[var(--color-text-secondary)]"><Loader2 className="h-5 w-5 animate-spin mr-2" />Loading compliance data...</div>;

  if (data.rules.length === 0) return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <ShieldCheck className="h-10 w-10 text-[var(--color-text-secondary)]/30 mb-3" />
      <p className="text-sm font-medium text-[var(--color-text-secondary)]">No AWS Config data yet</p>
      <p className="text-xs text-[var(--color-text-secondary)]/60 mt-1">AWS Config must be enabled in your account. Syncs every 15 minutes.</p>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-[var(--color-border)] p-4 bg-[var(--color-card)]">
          <p className="text-2xl font-bold text-[var(--color-text-primary)]">{data.total_rules}</p>
          <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">Total Rules</p>
        </div>
        <div className={`rounded-xl border p-4 ${data.non_compliant_rule_count === 0 ? 'border-green-500/20 bg-green-500/5' : 'border-red-500/20 bg-red-500/5'}`}>
          <p className={`text-2xl font-bold ${data.non_compliant_rule_count === 0 ? 'text-green-400' : 'text-red-400'}`}>{data.non_compliant_rule_count}</p>
          <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">Non-Compliant</p>
        </div>
        <div className={`rounded-xl border p-4 ${complianceRate >= 90 ? 'border-green-500/20 bg-green-500/5' : 'border-yellow-500/20 bg-yellow-500/5'}`}>
          <p className={`text-2xl font-bold ${complianceRate >= 90 ? 'text-green-400' : 'text-yellow-400'}`}>{complianceRate}%</p>
          <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">Compliance Rate</p>
        </div>
      </div>

      <div className="flex gap-2">
        {(['all', 'compliant', 'non_compliant'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1 text-xs rounded-full border transition-colors ${filter === f ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]' : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-card-hover)]'}`}>
            {f === 'all' ? `All Rules (${data.rules.length})` : f === 'compliant' ? `✅ Compliant` : `❌ Non-Compliant`}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {rules.map(rule => (
          <div key={rule.rule_name} className={`flex items-center justify-between p-3 rounded-lg border ${rule.is_compliant ? 'border-[var(--color-border)] bg-[var(--color-card)]' : 'border-red-500/20 bg-red-500/5'}`}>
            <div className="flex items-center gap-2.5">
              {rule.is_compliant
                ? <CheckCircle2 className="h-4 w-4 text-green-400 shrink-0" />
                : <AlertOctagon className="h-4 w-4 text-red-400 shrink-0" />}
              <div>
                <p className="text-xs font-semibold text-[var(--color-text-primary)]">{rule.rule_name}</p>
                <p className="text-[10px] text-[var(--color-text-secondary)]">{rule.description || rule.source_identifier}</p>
              </div>
            </div>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${rule.is_compliant ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
              {rule.is_compliant ? 'COMPLIANT' : 'NON-COMPLIANT'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function CloudAdaptersPage() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<Record<string, string> | null>(null);
  const [activeTab, setActiveTab] = useState<TelemetryTab>('connect');
  const [lastSync, setLastSync] = useState<string>('');
  // Provider context: clicking a provider card scopes ALL tabs to that provider
  const [activeProvider, setActiveProvider] = useState<Provider>('aws');

  const loadConnections = useCallback(async () => {
    try {
      const data = await apiFetch('/api/integrations/connections');
      setConnections(data.connections || []);
    } catch { }
  }, []);

  useEffect(() => { loadConnections(); }, [loadConnections]);

  const triggerSync = async () => {
    setSyncing(true); setSyncResult(null);
    try {
      const data = await apiFetch('/api/integrations/sync', { method: 'POST' });
      setSyncResult(data.results);
      setLastSync(new Date().toLocaleTimeString());
    } catch { }
    finally { setSyncing(false); }
  };

  const byProvider = (p: Provider) => connections.filter(c => c.provider === p);
  const totalConnections = connections.length;
  const hasAWS = byProvider('aws').length > 0;

  const tabs: { id: TelemetryTab; label: string; icon: any; requiresCloud?: 'aws' }[] = [
    { id: 'connect', label: 'Connect', icon: Cloud },
    { id: 'resources', label: 'Resources', icon: Server },
    { id: 'logs', label: 'Logs', icon: FileText },
    { id: 'traces', label: 'Traces', icon: GitBranch },
    { id: 'audit', label: 'Audit', icon: BookOpen, requiresCloud: 'aws' },
    { id: 'compliance', label: 'Compliance', icon: ShieldCheck, requiresCloud: 'aws' },
  ];

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div className="h-9 w-9 rounded-xl bg-[var(--color-primary)]/10 flex items-center justify-center">
              <Cloud className="h-5 w-5 text-[var(--color-primary)]" />
            </div>
            <h1 className="text-xl font-bold text-[var(--color-text-primary)]">Cloud Adapters</h1>
          </div>
          <p className="text-sm text-[var(--color-text-secondary)] ml-12">
            Connect AWS, Azure, GCP, and Kubernetes to stream live telemetry into the platform.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lastSync && (
            <div className="flex items-center gap-1.5 text-[10px] text-[var(--color-text-secondary)]">
              <Clock className="h-3 w-3" />
              Last sync: {lastSync}
            </div>
          )}
          <button
            onClick={triggerSync}
            disabled={syncing || totalConnections === 0}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-primary)] text-white text-sm font-semibold hover:opacity-90 disabled:opacity-40 transition-all"
          >
            {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {syncing ? 'Syncing…' : 'Sync Now'}
          </button>
        </div>
      </div>

      {/* Provider stats — clickable to scope all tabs */}
      <div className="grid grid-cols-4 gap-3">
        {(['aws', 'azure', 'gcp', 'kubernetes'] as Provider[]).map(p => {
          const count = byProvider(p).length;
          const cfg = PROVIDER_CONFIG[p];
          const isActive = activeProvider === p;
          return (
            <button
              key={p}
              onClick={() => setActiveProvider(p)}
              className={`rounded-xl p-4 border text-left transition-all duration-200 ${isActive
                ? 'ring-2 ring-[var(--color-primary)] ring-offset-2 ring-offset-[var(--color-background)] scale-[1.02]'
                : 'hover:scale-[1.01]'
                }`}
              style={{
                borderColor: isActive ? cfg.color : cfg.border,
                background: cfg.bg,
              }}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-lg">
                  {p === 'aws' ? '☁' : p === 'azure' ? '⬡' : p === 'gcp' ? '◈' : '⎈'}
                </span>
                {count > 0
                  ? <Wifi className="h-3.5 w-3.5 text-green-400" />
                  : <WifiOff className="h-3.5 w-3.5 text-[var(--color-text-secondary)]/40" />
                }
              </div>
              <p className="text-lg font-bold text-[var(--color-text-primary)]">{count}</p>
              <p className="text-[10px] text-[var(--color-text-secondary)]">
                {cfg.label}
              </p>
            </button>
          );
        })}
      </div>

      {/* AWS data sources architecture */}
      <AWSSourcesPanel hasConnection={hasAWS} />

      {/* Azure data sources architecture */}
      <AzureSourcesPanel hasConnection={byProvider('azure').length > 0} />

      {/* GCP data sources architecture */}
      <GCPSourcesPanel hasConnection={byProvider('gcp').length > 0} />

      {/* Sync result */}
      {syncResult && (
        <div className="rounded-xl border border-[var(--color-border)] p-4 bg-[var(--color-card)]">
          <p className="text-xs font-semibold text-[var(--color-text-primary)] mb-3">Sync Complete</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {Object.entries(syncResult).map(([key, val]) => (
              <div key={key} className={`flex items-center gap-2 text-xs p-2 rounded-lg border ${val === 'ok' ? 'border-green-500/20 bg-green-500/5' : 'border-yellow-500/20 bg-yellow-500/5'}`}>
                {val === 'ok'
                  ? <CheckCircle2 className="h-3.5 w-3.5 text-green-400 shrink-0" />
                  : <AlertTriangle className="h-3.5 w-3.5 text-yellow-400 shrink-0" />}
                <div>
                  <p className="capitalize font-semibold text-[var(--color-text-primary)]">{key.replace(/_/g, ' ')}</p>
                  <p className={val === 'ok' ? 'text-green-400' : 'text-yellow-400'}>{val}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-[var(--color-border)] overflow-x-auto">
        {tabs.map(tab => {
          const Icon = tab.icon;
          const disabled = tab.requiresCloud === 'aws' && !hasAWS;
          return (
            <button key={tab.id} onClick={() => !disabled && setActiveTab(tab.id)}
              disabled={disabled}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors relative whitespace-nowrap ${activeTab === tab.id ? 'text-[var(--color-primary)]' : disabled ? 'text-[var(--color-text-secondary)]/30 cursor-not-allowed' : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'}`}>
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
              {disabled && <span className="text-[9px] px-1 py-0.5 rounded bg-[var(--color-border)] text-[var(--color-text-secondary)]/50">AWS</span>}
              {activeTab === tab.id && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--color-primary)] rounded-full" />}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      {activeTab === 'connect' && (
        <div className="grid gap-4">
          {(['aws', 'azure', 'gcp', 'kubernetes'] as Provider[]).map(p => (
            <ProviderCard key={p} provider={p} connections={byProvider(p)} onRefresh={loadConnections} />
          ))}
        </div>
      )}
      {activeTab === 'resources' && <ResourcesPanel activeProvider={activeProvider} />}
      {activeTab === 'logs' && <LogsPanel activeProvider={activeProvider} />}
      {activeTab === 'traces' && <TracesPanel activeProvider={activeProvider} />}
      {activeTab === 'audit' && <AuditPanel activeProvider={activeProvider} />}
      {activeTab === 'compliance' && <CompliancePanel activeProvider={activeProvider} />}

      {/* Info footer */}
      <div className="rounded-xl border border-[var(--color-border)] p-4 bg-[var(--color-card-hover)] text-xs text-[var(--color-text-secondary)] space-y-2">
        <p className="font-semibold text-[var(--color-text-primary)]">Auto-sync schedule</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { label: 'Resources', freq: '1 min' }, { label: 'Metrics', freq: '1 min' },
            { label: 'Alerts', freq: '30 sec' }, { label: 'Logs', freq: '2 min' },
            { label: 'X-Ray Traces', freq: '1 min' }, { label: 'Audit Events', freq: '5 min' },
            { label: 'Config', freq: '15 min' },
          ].map(item => (
            <div key={item.label} className="flex items-center gap-1.5">
              <Clock className="h-3 w-3 text-[var(--color-primary)]" />
              <span className="font-medium text-[var(--color-text-primary)]">{item.label}:</span> {item.freq}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
