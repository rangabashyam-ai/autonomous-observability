import { useState, useEffect } from 'react';
import {
  Cloud, Plus, Trash2, RefreshCw, CheckCircle2, XCircle,
  AlertTriangle, ChevronDown, ChevronUp, Server, Database,
  Box, Layers, Wifi, WifiOff, Loader2, Eye, EyeOff
} from 'lucide-react';

const API = 'http://localhost:8000';

// ─── Types ────────────────────────────────────────────────────────────────────

type Provider = 'aws' | 'azure' | 'gcp' | 'kubernetes';

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

interface SyncStatus {
  resources: string;
  metrics: string;
  alerts: string;
}

// ─── Provider brand config ─────────────────────────────────────────────────────

const PROVIDER_CONFIG: Record<Provider, { label: string; color: string; bg: string; border: string }> = {
  aws:        { label: 'Amazon AWS',       color: '#FF9900', bg: 'rgba(255,153,0,0.08)',   border: 'rgba(255,153,0,0.25)' },
  azure:      { label: 'Microsoft Azure',  color: '#0078D4', bg: 'rgba(0,120,212,0.08)',   border: 'rgba(0,120,212,0.25)' },
  gcp:        { label: 'Google Cloud',     color: '#4285F4', bg: 'rgba(66,133,244,0.08)',  border: 'rgba(66,133,244,0.25)' },
  kubernetes: { label: 'Kubernetes',       color: '#326CE5', bg: 'rgba(50,108,229,0.08)',  border: 'rgba(50,108,229,0.25)' },
};

const RESOURCE_TYPE_ICON: Record<string, string> = {
  ec2_instance: '🖥️', eks_cluster: '⎈', rds_instance: '🗄️', load_balancer: '⚖️',
  azure_vm: '🖥️', aks_cluster: '⎈', azure_sql: '🗄️',
  gce_instance: '🖥️', gke_cluster: '⎈', cloud_sql: '🗄️',
  k8s_pod: '📦', k8s_node: '🖧', k8s_deployment: '🚀', k8s_service: '🔗',
  k8s_namespace: '📁', k8s_ingress: '🌐',
};

// ─── API helpers ──────────────────────────────────────────────────────────────

async function apiFetch(path: string, options?: RequestInit) {
  const res = await fetch(`${API}${path}`, options);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || res.statusText);
  }
  return res.json();
}

// ─── Form fields per provider ─────────────────────────────────────────────────

function AWSForm({ onSuccess }: { onSuccess: () => void }) {
  const [form, setForm] = useState({ connection_name: '', role_arn: '', region: 'us-east-1', external_id: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      await apiFetch('/api/integrations/aws/connect', {
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
      <FormField label="Connection Name *" value={form.connection_name} onChange={v => setForm(p => ({ ...p, connection_name: v }))} placeholder="e.g. prod-aws" required />
      <FormField label="IAM Role ARN" value={form.role_arn} onChange={v => setForm(p => ({ ...p, role_arn: v }))} placeholder="arn:aws:iam::123456789012:role/MyRole" />
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Region" value={form.region} onChange={v => setForm(p => ({ ...p, region: v }))} placeholder="us-east-1" />
        <FormField label="External ID (optional)" value={form.external_id} onChange={v => setForm(p => ({ ...p, external_id: v }))} placeholder="optional" />
      </div>
      <FormActions loading={loading} error={error} label="Connect AWS" />
    </form>
  );
}

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
          {/* Existing connections */}
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

          {/* Add new connection form */}
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

// ─── Resources Panel ──────────────────────────────────────────────────────────

function ResourcesPanel() {
  const [resources, setResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Provider | 'all'>('all');

  useEffect(() => {
    setLoading(true);
    apiFetch('/api/integrations/resources?limit=500')
      .then(d => setResources(d.resources || []))
      .catch(() => setResources([]))
      .finally(() => setLoading(false));
  }, []);

  const filtered = filter === 'all' ? resources : resources.filter(r => r.provider === filter);
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
      <p className="text-sm font-medium text-[var(--color-text-secondary)]">No resources discovered yet</p>
      <p className="text-xs text-[var(--color-text-secondary)]/60 mt-1 max-w-xs">
        Connect a cloud provider above, then click "Sync Now" to discover your infrastructure.
      </p>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {(['all', 'aws', 'azure', 'gcp', 'kubernetes'] as const).map(p => (
          <button key={p} onClick={() => setFilter(p)}
            className={`px-3 py-1 text-xs rounded-full border transition-colors ${filter === p ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]' : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-card-hover)]'}`}>
            {p === 'all' ? `All (${resources.length})` : `${PROVIDER_CONFIG[p].label} (${resources.filter(r => r.provider === p).length})`}
          </button>
        ))}
      </div>

      {/* Summary chips */}
      <div className="flex gap-2 flex-wrap">
        {Object.entries(byType).map(([type, count]) => (
          <span key={type} className="text-[10px] px-2 py-0.5 rounded bg-[var(--color-card-hover)] border border-[var(--color-border)] text-[var(--color-text-secondary)]">
            {RESOURCE_TYPE_ICON[type] || '📌'} {type.replace(/_/g, ' ')} · {count}
          </span>
        ))}
      </div>

      {/* Resource table */}
      <div className="rounded-xl border border-[var(--color-border)] overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[var(--color-border)] bg-[var(--color-card-hover)]">
              <th className="px-4 py-2.5 text-left font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider text-[10px]">Resource</th>
              <th className="px-4 py-2.5 text-left font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider text-[10px]">Type</th>
              <th className="px-4 py-2.5 text-left font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider text-[10px]">Provider</th>
              <th className="px-4 py-2.5 text-left font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider text-[10px]">Region</th>
              <th className="px-4 py-2.5 text-left font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider text-[10px]">Health</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border)]">
            {filtered.map(r => (
              <tr key={r.id} className="hover:bg-[var(--color-card-hover)] transition-colors">
                <td className="px-4 py-2.5 font-medium text-[var(--color-text-primary)] max-w-[180px] truncate">{r.name}</td>
                <td className="px-4 py-2.5 text-[var(--color-text-secondary)]">
                  {RESOURCE_TYPE_ICON[r.resource_type] || '📌'} {r.resource_type.replace(/_/g, ' ')}
                </td>
                <td className="px-4 py-2.5">
                  <span className="font-semibold" style={{ color: PROVIDER_CONFIG[r.provider]?.color }}>
                    {r.provider.toUpperCase()}
                  </span>
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

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function CloudIntegrationsPage() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncStatus | null>(null);
  const [activeTab, setActiveTab] = useState<'connect' | 'resources'>('connect');
  const [lastSync, setLastSync] = useState<string>('');

  const loadConnections = async () => {
    try {
      const data = await apiFetch('/api/integrations/connections');
      setConnections(data.connections || []);
    } catch { }
  };

  useEffect(() => { loadConnections(); }, []);

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

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div className="h-9 w-9 rounded-xl bg-[var(--color-primary)]/10 flex items-center justify-center">
              <Cloud className="h-5 w-5 text-[var(--color-primary)]" />
            </div>
            <h1 className="text-xl font-bold text-[var(--color-text-primary)]">Cloud Integrations</h1>
          </div>
          <p className="text-sm text-[var(--color-text-secondary)] ml-12">
            Connect AWS, Azure, GCP, and Kubernetes to stream live telemetry into the platform.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lastSync && (
            <p className="text-[10px] text-[var(--color-text-secondary)]">Last sync: {lastSync}</p>
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

      {/* Stats bar */}
      <div className="grid grid-cols-4 gap-3">
        {(['aws', 'azure', 'gcp', 'kubernetes'] as Provider[]).map(p => {
          const count = byProvider(p).length;
          const cfg = PROVIDER_CONFIG[p];
          return (
            <div key={p} className="rounded-xl p-4 border" style={{ borderColor: cfg.border, background: cfg.bg }}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-lg">{p === 'aws' ? '☁' : p === 'azure' ? '⬡' : p === 'gcp' ? '◈' : '⎈'}</span>
                {count > 0
                  ? <Wifi className="h-3.5 w-3.5 text-green-400" />
                  : <WifiOff className="h-3.5 w-3.5 text-[var(--color-text-secondary)]/40" />}
              </div>
              <p className="text-lg font-bold text-[var(--color-text-primary)]">{count}</p>
              <p className="text-[10px] text-[var(--color-text-secondary)]">{cfg.label}</p>
            </div>
          );
        })}
      </div>

      {/* Sync result */}
      {syncResult && (
        <div className="rounded-xl border border-[var(--color-border)] p-4 bg-[var(--color-card)] flex flex-wrap gap-4">
          <p className="text-xs font-semibold text-[var(--color-text-primary)] w-full">Sync Complete</p>
          {Object.entries(syncResult).map(([key, val]) => (
            <div key={key} className="flex items-center gap-2 text-xs">
              {val === 'ok'
                ? <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />
                : <AlertTriangle className="h-3.5 w-3.5 text-yellow-400" />}
              <span className="capitalize font-medium text-[var(--color-text-primary)]">{key}:</span>
              <span className={val === 'ok' ? 'text-green-400' : 'text-yellow-400'}>{val}</span>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-[var(--color-border)]">
        {(['connect', 'resources'] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium transition-colors relative ${activeTab === tab ? 'text-[var(--color-primary)]' : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'}`}>
            {tab === 'connect' ? 'Connect Providers' : 'Discovered Resources'}
            {activeTab === tab && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--color-primary)] rounded-full" />}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'connect' ? (
        <div className="grid gap-4">
          {(['aws', 'azure', 'gcp', 'kubernetes'] as Provider[]).map(p => (
            <ProviderCard key={p} provider={p} connections={byProvider(p)} onRefresh={loadConnections} />
          ))}
        </div>
      ) : (
        <ResourcesPanel />
      )}

      {/* Info footer */}
      <div className="rounded-xl border border-[var(--color-border)] p-4 bg-[var(--color-card-hover)] text-xs text-[var(--color-text-secondary)] space-y-1">
        <p className="font-semibold text-[var(--color-text-primary)]">How it works</p>
        <p>Once connected, resources are auto-discovered every <strong>30 minutes</strong>, metrics every <strong>1 minute</strong>, and alerts every <strong>30 seconds</strong>.</p>
        <p>Live data flows automatically into the Executive Dashboard, RCA Engine, Blast Radius Analyzer, and Dependency Map — no additional configuration needed.</p>
      </div>
    </div>
  );
}
