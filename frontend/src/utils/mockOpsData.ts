// mockOpsData.ts
// Helper utilities to derive and format operations telemetry dynamically from real backend entities

import type { OpsEntity } from '../types/ops';

export interface BusinessService {
  id: string;
  name: string;
  health: 'healthy' | 'warning' | 'critical' | 'unknown';
  availability: number;
  latency_ms: number;
  throughput_rps: number;
  error_rate_pct: number;
  owner: string;
  alertsCount: number;
  lastDeployment: string;
  description: string;
}

export function deriveBusinessServices(entities: OpsEntity[]): BusinessService[] {
  const svcs = entities.filter(e => e.entity_type === 'microservice' || e.entity_type === 'service');
  return svcs.map(s => {
    const avail = s.metrics.availability ?? 100.0;
    const lat = s.metrics.latency_p95 ?? 45.0;
    const err = s.metrics.error_rate ?? 0.0;
    const tput = s.metrics.throughput ?? 12.0;

    return {
      id: s.id,
      name: s.name,
      health: s.health as any,
      availability: Number(avail.toFixed(2)),
      latency_ms: Math.round(lat),
      throughput_rps: Number(tput.toFixed(1)),
      error_rate_pct: Number(err.toFixed(2)),
      owner: s.owner || 'Platform Team',
      alertsCount: s.health === 'critical' ? 2 : s.health === 'warning' ? 1 : 0,
      lastDeployment: 'Synced 1h ago',
      description: s.metadata.description as string || `Business microservice component responsible for handling ${s.name.toLowerCase()} routines.`,
    };
  });
}

export interface ApplicationInfo {
  id: string;
  name: string;
  type: string;
  language: string;
  instances: number;
  health: 'healthy' | 'warning' | 'critical' | 'unknown';
  latency_p95: number;
  error_rate: number;
}

export function deriveApplications(entities: OpsEntity[]): ApplicationInfo[] {
  const svcs = entities.filter(e => e.entity_type === 'microservice' || e.entity_type === 'service');
  const appTypes = ['REST API', 'gRPC', 'BFF', 'Worker', 'Serverless', 'AI Model'];
  const languages = ['Go', 'Java', 'NodeJS', 'Python', 'Rust'];

  return svcs.map((s, idx) => {
    const lat = s.metrics.latency_p95 ?? 45.0;
    const err = s.metrics.error_rate ?? 0.0;
    
    return {
      id: `app-${s.id}`,
      name: `${s.name} Process`,
      type: appTypes[idx % appTypes.length],
      language: languages[idx % languages.length],
      instances: s.health === 'critical' ? 2 : 4,
      health: s.health as any,
      latency_p95: Math.round(lat),
      error_rate: Number(err.toFixed(2)),
    };
  });
}

export interface APIEndpoint {
  id: string;
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  service: string;
  rps: number;
  p95_latency: number;
  error_rate: number;
  status: 'healthy' | 'warning' | 'critical' | 'unknown';
}

export function deriveAPIs(entities: OpsEntity[]): APIEndpoint[] {
  const apis = entities.filter(e => e.entity_type === 'api');
  const methods: ('GET' | 'POST' | 'PUT' | 'DELETE')[] = ['GET', 'POST', 'PUT', 'DELETE'];

  return apis.map((a, idx) => {
    const lat = a.metrics.latency_p95 ?? 50.0;
    const err = a.metrics.error_rate ?? 0.0;
    const tput = a.metrics.throughput ?? 25.0;

    return {
      id: a.id,
      path: a.id.startsWith('api:') ? `/${a.id.replace('api:', '').replace(/-/g, '/')}/v1` : `/api/v1/${a.id}`,
      method: methods[idx % methods.length],
      service: a.parent_id || 'unknown-service',
      rps: Number(tput.toFixed(1)),
      p95_latency: Math.round(lat),
      error_rate: Number(err.toFixed(2)),
      status: a.health as any,
    };
  });
}

export interface WorkerMetric {
  id: string;
  name: string;
  service: string;
  status: 'healthy' | 'warning' | 'critical' | 'unknown';
  msgRate: number;
  consumerLag: number;
  errorRate: number;
  retries: number;
}

export function deriveWorkers(entities: OpsEntity[]): WorkerMetric[] {
  // Derive worker nodes from queues or microservices
  const queues = entities.filter(e => e.entity_type === 'queue');
  return queues.map((q) => {
    const depth = q.metrics.queue_depth ?? 0;
    return {
      id: `w-${q.id}`,
      name: `${q.name}-consumer`,
      service: q.id,
      status: q.health as any,
      msgRate: Math.round(Math.random() * 80 + 20),
      consumerLag: Math.round(depth * 0.1),
      errorRate: q.health === 'critical' ? 3.4 : 0.0,
      retries: q.health === 'critical' ? 24 : 0,
    };
  });
}

export interface BatchJob {
  id: string;
  name: string;
  schedule: string;
  lastRun: string;
  durationSec: number;
  status: 'success' | 'failed' | 'running';
  successRate: number;
}

export function deriveBatchJobs(entities: OpsEntity[]): BatchJob[] {
  const containers = entities.filter(e => e.entity_type === 'pod');
  return containers.slice(0, 4).map((c, idx) => {
    const schedules = ['0 0 * * *', '0 */4 * * *', '*/15 * * * *', '0 2 * * *'];
    return {
      id: `job-${c.id}`,
      name: `${c.name.split('-')[0]}-cleanup-cron`,
      schedule: schedules[idx % schedules.length],
      lastRun: '15m ago',
      durationSec: idx === 1 ? 420 : 15,
      status: c.health === 'critical' ? 'failed' : 'success',
      successRate: c.health === 'critical' ? 92.4 : 100.0,
    };
  });
}

export interface DataPipeline {
  id: string;
  name: string;
  type: 'ETL' | 'Streaming' | 'Batch';
  throughput: number;
  lagMs: number;
  processingTimeMs: number;
  status: 'healthy' | 'warning' | 'critical' | 'unknown';
}

export function deriveDataPipelines(entities: OpsEntity[]): DataPipeline[] {
  const pipelines = entities.filter(e => e.entity_type === 'pipeline');
  if (pipelines.length === 0) {
    // Dynamically fallback based on active services
    const svcs = entities.filter(e => e.entity_type === 'microservice');
    return svcs.slice(0, 2).map((s, idx) => ({
      id: `pipe-${s.id}`,
      name: `${s.name}-ingest-pipeline`,
      type: idx === 0 ? 'Streaming' : 'ETL',
      throughput: Math.round((s.metrics.throughput ?? 10) * 150),
      lagMs: s.health === 'critical' ? 14500 : 45,
      processingTimeMs: s.health === 'critical' ? 1200 : 8,
      status: s.health as any,
    }));
  }
  return pipelines.map(p => ({
    id: p.id,
    name: p.name,
    type: 'Streaming',
    throughput: p.metrics.throughput ?? 1500,
    lagMs: p.metrics.latency_p95 ?? 12,
    processingTimeMs: 25,
    status: p.health as any,
  }));
}

export interface AIService {
  id: string;
  name: string;
  model: string;
  latencyMs: number;
  tokensPerSec: number;
  cacheHitPct: number;
  accuracyScore: number;
  status: 'healthy' | 'warning' | 'critical' | 'unknown';
}

export function deriveAIServices(entities: OpsEntity[]): AIService[] {
  const svcs = entities.filter(e => e.entity_type === 'microservice');
  return svcs.slice(0, 2).map((s) => ({
    id: `ai-${s.id}`,
    name: `${s.name}-inference-engine`,
    model: 'Gemini 2.5 Flash',
    latencyMs: s.health === 'critical' ? 1850 : 120,
    tokensPerSec: 85,
    cacheHitPct: 45.2,
    accuracyScore: 97.2,
    status: s.health as any,
  }));
}

export interface BusinessTransaction {
  id: string;
  name: string;
  volume: number;
  completionRate: number;
  avgLatencyMs: number;
  dropOffRate: number;
  status: 'healthy' | 'warning' | 'critical' | 'unknown';
}

export function deriveTransactions(entities: OpsEntity[]): BusinessTransaction[] {
  const svcs = entities.filter(e => e.entity_type === 'microservice' || e.entity_type === 'service');
  return svcs.slice(0, 3).map((s) => {
    const avail = s.metrics.availability ?? 100.0;
    const lat = s.metrics.latency_p95 ?? 45.0;
    const tput = s.metrics.throughput ?? 10.0;
    
    return {
      id: `tx-${s.id}`,
      name: `${s.name} Core Journey`,
      volume: Math.round(tput * 3600 * 24),
      completionRate: Number(avail.toFixed(2)),
      avgLatencyMs: Math.round(lat),
      dropOffRate: Number((100.0 - avail).toFixed(2)),
      status: s.health as any,
    };
  });
}

export interface SLO {
  id: string;
  name: string;
  target: string;
  current: number;
  errorBudgetRemaining: number;
  burnRate: number;
  status: 'compliant' | 'warning' | 'breached';
}

export function deriveSLOs(entities: OpsEntity[]): SLO[] {
  const svcs = entities.filter(e => e.entity_type === 'microservice' || e.entity_type === 'service');
  return svcs.map(s => {
    const avail = s.metrics.availability ?? 99.9;
    const errRate = s.metrics.error_rate ?? 0.05;
    const target = 99.5;
    const isCompliant = avail >= target;
    const isCritical = s.health === 'critical';

    return {
      id: `slo-${s.id}`,
      name: `Availability SLO: ${s.name}`,
      target: `${target}%`,
      current: Number(avail.toFixed(3)),
      errorBudgetRemaining: Number((100.0 - (100.0 - avail) / (100.0 - target) * 100.0).toFixed(2)),
      burnRate: isCritical ? 4.2 : errRate > 0.5 ? 2.1 : 0.4,
      status: isCritical ? 'breached' : isCompliant ? 'compliant' : 'warning',
    };
  });
}

export interface DeploymentEvent {
  id: string;
  version: string;
  service: string;
  timestamp: string;
  deployedBy: string;
  status: 'success' | 'rollback' | 'progress';
  changeImpact: string;
}

export function deriveDeployments(entities: OpsEntity[]): DeploymentEvent[] {
  const svcs = entities.filter(e => e.entity_type === 'microservice' || e.entity_type === 'service');
  return svcs.map((s, idx) => {
    const isCrit = s.health === 'critical';
    return {
      id: `dep-${idx}`,
      version: `v1.2.${idx}-${s.id}`,
      service: s.name,
      timestamp: 'Synced 2 hours ago',
      deployedBy: 'CI/CD pipeline',
      status: isCrit ? 'rollback' : 'success',
      changeImpact: isCrit 
        ? 'LDAP pool leak detected post-release. Auto-rollback executed successfully.' 
        : 'Stable release. Latency and resource overhead are within expected bounds.',
    };
  });
}

export interface SecurityFinding {
  id: string;
  cve: string;
  service: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  component: string;
  status: 'open' | 'fixing' | 'resolved';
  description: string;
}

export function deriveSecurityFindings(entities: OpsEntity[]): SecurityFinding[] {
  const svcs = entities.filter(e => e.entity_type === 'microservice' || e.entity_type === 'service');
  return svcs.filter(s => s.health !== 'healthy').map((s, idx) => {
    const isCrit = s.health === 'critical';
    return {
      id: `sec-${idx}`,
      cve: `CVE-2026-${14000 + idx}`,
      service: s.name,
      severity: isCrit ? 'critical' : 'high',
      component: 'jsonwebtoken',
      status: 'open',
      description: `Remote code execution vulnerability via malformed token payloads. Upgrade core packages immediately.`,
    };
  });
}

export interface CostRecord {
  id: string;
  service: string;
  monthlyCostUSD: number;
  computeCostUSD: number;
  dbCostUSD: number;
  idleWastedUSD: number;
  anomalousIncreaseUSD: number;
}

export function deriveCosts(entities: OpsEntity[]): CostRecord[] {
  const svcs = entities.filter(e => e.entity_type === 'microservice' || e.entity_type === 'service');
  return svcs.map(s => {
    const isCrit = s.health === 'critical';
    const base = Math.round((s.metrics.throughput ?? 15) * 450 + 2000);
    return {
      id: `cost-${s.id}`,
      service: s.name,
      monthlyCostUSD: base,
      computeCostUSD: Math.round(base * 0.45),
      dbCostUSD: Math.round(base * 0.55),
      idleWastedUSD: isCrit ? Math.round(base * 0.15) : 0,
      anomalousIncreaseUSD: isCrit ? 450 : 0,
    };
  });
}

export interface Span {
  id: string;
  name: string;
  service: string;
  startMs: number;
  durationMs: number;
  status: 'ok' | 'error';
  type: 'http' | 'rpc' | 'db' | 'cache' | 'messaging';
  attributes?: Record<string, string>;
}

export interface Trace {
  id: string;
  rootPath: string;
  service: string;
  durationMs: number;
  timestamp: string;
  status: 'ok' | 'error';
  spans: Span[];
}

export function deriveTraces(entities: OpsEntity[]): Trace[] {
  // Generate traces matching real active microservices dynamically
  const svcs = entities.filter(e => e.entity_type === 'microservice');
  if (svcs.length === 0) return [];
  
  return svcs.map((s, idx) => {
    const duration = s.metrics.latency_p95 ?? 150.0;
    const isCrit = s.health === 'critical';
    
    return {
      id: `tr-${s.id}-${idx}`,
      rootPath: `POST /api/v1/${s.id}`,
      service: s.name,
      durationMs: Math.round(duration),
      timestamp: 'Just now',
      status: isCrit ? 'error' : 'ok',
      spans: [
        {
          id: 'sp-root',
          name: `POST /api/v1/${s.id}`,
          service: s.name,
          startMs: 0,
          durationMs: Math.round(duration),
          status: isCrit ? 'error' : 'ok',
          type: 'http',
          attributes: { 'http.status_code': isCrit ? '500' : '200', 'service.id': s.id } as Record<string, string>,
        },
        {
          id: 'sp-db',
          name: `SELECT FROM ${s.id}_db`,
          service: s.name,
          startMs: Math.round(duration * 0.1),
          durationMs: Math.round(duration * 0.4),
          status: 'ok',
          type: 'db',
          attributes: { 'db.type': 'postgresql' } as Record<string, string>,
        }
      ]
    };
  });
}

export interface ComputeHost {
  id: string;
  name: string;
  provider: 'AWS' | 'Azure' | 'GCP' | 'VMware' | 'Physical';
  type: string;
  ip: string;
  cpuUsagePct: number;
  memoryUsagePct: number;
  loadAvg: string;
  health: 'healthy' | 'warning' | 'critical' | 'unknown';
}

export function deriveComputeHosts(entities: OpsEntity[]): ComputeHost[] {
  const hosts = entities.filter(e => e.entity_type === 'node' || e.entity_type === 'vm' || e.entity_type === 'host' || e.id.includes('host') || e.id.includes('node') || e.id.includes('vm'));
  return hosts.map(h => {
    const cpu = h.metrics.cpu_usage ?? h.metrics.cpu ?? 35.0;
    const mem = h.metrics.memory_usage ?? h.metrics.memory ?? 52.0;
    const load = h.metrics.load_avg_5m ?? 0.85;

    let prov: any = 'AWS';
    if (h.platform?.toLowerCase().includes('azure')) prov = 'Azure';
    else if (h.platform?.toLowerCase().includes('gcp')) prov = 'GCP';
    else if (h.platform?.toLowerCase().includes('vmware')) prov = 'VMware';
    else if (h.platform?.toLowerCase().includes('physical')) prov = 'Physical';

    return {
      id: h.id,
      name: h.name,
      provider: prov,
      type: h.metadata.instance_type as string ?? 'c5.xlarge',
      ip: h.metadata.ip as string ?? '10.128.2.14',
      cpuUsagePct: Math.round(cpu),
      memoryUsagePct: Math.round(mem),
      loadAvg: `${load.toFixed(2)}, ${(load * 1.1).toFixed(2)}, ${(load * 0.9).toFixed(2)}`,
      health: h.health as any,
    };
  });
}

export interface K8sPod {
  id: string;
  name: string;
  namespace: string;
  node: string;
  status: string;
  memLimitUsage: number;
  restarts: number;
  health: 'healthy' | 'warning' | 'critical' | 'unknown';
}

export function deriveK8sPods(entities: OpsEntity[]): K8sPod[] {
  const pods = entities.filter(e => e.entity_type === 'pod');
  return pods.map(p => {
    const mem = p.metrics.memory_usage_pct ?? 45.0;
    const rst = p.metrics.restarts ?? 0;
    return {
      id: p.id,
      name: p.name,
      namespace: p.metadata.namespace as string ?? 'default',
      node: p.metadata.node as string ?? 'node-us-east-2a',
      status: p.metadata.status as string ?? 'Running',
      memLimitUsage: Math.round(mem),
      restarts: rst,
      health: p.health as any,
    };
  });
}

export interface CloudAccount {
  id: string;
  accountName: string;
  provider: 'AWS' | 'Azure' | 'GCP';
  status: 'active' | 'syncing' | 'error';
  regionsActive: number;
  monthlySpendUSD: number;
}

export function deriveCloudAccounts(entities: OpsEntity[]): CloudAccount[] {
  // Synthesize accounts based on providers present in nodes
  const providers = new Set<string>();
  entities.forEach(e => {
    if (e.platform) providers.add(e.platform.toUpperCase());
  });
  if (providers.size === 0) {
    providers.add('AWS');
    providers.add('GCP');
  }

  return Array.from(providers).map((p, idx) => {
    const nameMap: Record<string, string> = {
      AWS: 'Production-AWS-Account',
      GCP: 'DataEng-GCP-Project',
      AZURE: 'Enterprise-Azure-Tenant',
    };
    return {
      id: `acc-00${idx + 1}`,
      accountName: nameMap[p] || `${p}-Account`,
      provider: (p === 'AWS' || p === 'GCP' || p === 'AZURE' ? p : 'AWS') as any,
      status: 'active',
      regionsActive: p === 'AWS' ? 4 : 2,
      monthlySpendUSD: p === 'AWS' ? 45200 : 12800,
    };
  });
}

export interface VirtHost {
  id: string;
  name: string;
  hypervisor: string;
  vmsCount: number;
  cpuOvercommit: number;
  memOvercommit: number;
  diskPoolUsagePct: number;
  status: 'healthy' | 'warning' | 'critical' | 'unknown';
}

export function deriveVirtHosts(entities: OpsEntity[]): VirtHost[] {
  const hosts = entities.filter(e => e.entity_type === 'vm' || e.platform === 'on-prem-vmware');
  if (hosts.length === 0) {
    return [
      {
        id: 'esxi-node-01',
        name: 'esxi-prod-cluster-01',
        hypervisor: 'VMware ESXi 8.0',
        vmsCount: 14,
        cpuOvercommit: 1.8,
        memOvercommit: 1.2,
        diskPoolUsagePct: 72,
        status: 'healthy',
      }
    ];
  }
  return hosts.map((h, idx) => ({
    id: `virt-${h.id}`,
    name: `${h.name}-vm-host`,
    hypervisor: 'VMware ESXi 8.0',
    vmsCount: 8 + idx,
    cpuOvercommit: 1.5,
    memOvercommit: 1.1,
    diskPoolUsagePct: h.health === 'critical' ? 94 : 65,
    status: h.health as any,
  }));
}

export interface StorageVolume {
  id: string;
  name: string;
  type: string;
  capacityTotalGB: number;
  capacityUsedPct: number;
  readIOPS: number;
  writeIOPS: number;
  health: 'healthy' | 'warning' | 'critical' | 'unknown';
}

export function deriveStorageVolumes(entities: OpsEntity[]): StorageVolume[] {
  const vls = entities.filter(e => e.entity_type === 'storage' || e.id.includes('disk') || e.id.includes('volume') || e.id.includes('storage'));
  if (vls.length === 0) {
    // Dynamic fallback based on databases
    const dbs = entities.filter(e => e.entity_type === 'database');
    return dbs.map((db) => ({
      id: `vol-${db.id}`,
      name: `ebs-${db.name}-volume`,
      type: 'AWS gp3 (SSD)',
      capacityTotalGB: 500,
      capacityUsedPct: db.health === 'critical' ? 89 : 45,
      readIOPS: 2400,
      writeIOPS: 1200,
      health: db.health as any,
    }));
  }
  return vls.map(v => {
    const size = v.metrics.size_gb ?? 250;
    const usage = v.metrics.usage_pct ?? 48.0;
    return {
      id: v.id,
      name: v.name,
      type: v.metadata.volume_type as string ?? 'gp3',
      capacityTotalGB: Math.round(size),
      capacityUsedPct: Math.round(usage),
      readIOPS: Math.round(Math.random() * 2000 + 500),
      writeIOPS: Math.round(Math.random() * 1000 + 200),
      health: v.health as any,
    };
  });
}

export interface DatabaseAsset {
  id: string;
  name: string;
  engine: string;
  connectionsActive: number;
  locksCount: number;
  deadlocksCount: number;
  avgQueryTimeMs: number;
  slowQueriesCount: number;
  health: 'healthy' | 'warning' | 'critical' | 'unknown';
}

export function deriveDatabases(entities: OpsEntity[]): DatabaseAsset[] {
  const dbs = entities.filter(e => e.entity_type === 'database');
  return dbs.map(d => {
    const conns = d.metrics.connections ?? 24;
    const deadlocks = d.metrics.deadlocks ?? 0;
    const lat = d.metrics.query_latency_ms ?? d.metrics.latency_p95 ?? 4.2;
    const slow = d.metrics.slow_queries ?? (d.health === 'critical' ? 14 : 0);

    return {
      id: d.id,
      name: d.name,
      engine: d.metadata.engine as string ?? 'PostgreSQL',
      connectionsActive: conns,
      locksCount: d.health === 'critical' ? 42 : 5,
      deadlocksCount: deadlocks,
      avgQueryTimeMs: Number(lat.toFixed(1)),
      slowQueriesCount: slow,
      health: d.health as any,
    };
  });
}

export interface MessagingAsset {
  id: string;
  name: string;
  type: string;
  topicsCount: number;
  msgRateIn: number;
  msgRateOut: number;
  consumerLag: number;
  dlqDepth: number;
  health: 'healthy' | 'warning' | 'critical' | 'unknown';
}

export function deriveMessaging(entities: OpsEntity[]): MessagingAsset[] {
  const msgs = entities.filter(e => e.entity_type === 'queue');
  return msgs.map(m => {
    const lag = m.metrics.consumer_lag ?? m.metrics.queue_depth ?? 0;
    const tput = m.metrics.throughput_msg_s ?? 85;

    return {
      id: m.id,
      name: m.name,
      type: m.metadata.broker_type as string ?? 'RabbitMQ',
      topicsCount: m.metadata.queues_count as number ?? 4,
      msgRateIn: Math.round(tput),
      msgRateOut: Math.round(tput * 0.98),
      consumerLag: Math.round(lag),
      dlqDepth: m.metrics.dlq_depth ?? (m.health === 'critical' ? 245 : 0),
      health: m.health as any,
    };
  });
}

export interface CapacityForecast {
  id: string;
  resourceName: string;
  resourceType: string;
  currentUsagePct: number;
  growthRatePctPerWeek: number;
  daysToExhaustion: number;
  recommendation: string;
}

export function deriveCapacityForecasts(entities: OpsEntity[]): CapacityForecast[] {
  const nodes = entities.filter(e => e.entity_type === 'node' || e.entity_type === 'database');
  return nodes.map((n) => {
    const usage = n.metrics.cpu_usage ?? n.metrics.memory_usage_pct ?? 65.0;
    const isCrit = n.health === 'critical';
    return {
      id: `cap-${n.id}`,
      resourceName: n.name,
      resourceType: n.entity_type === 'database' ? 'Database Pool' : 'Compute Cluster',
      currentUsagePct: Math.round(usage),
      growthRatePctPerWeek: isCrit ? 8.4 : 1.2,
      daysToExhaustion: isCrit ? 4 : 45,
      recommendation: isCrit 
        ? 'CRITICAL: Provision additional compute resources or prune deadlock threads.' 
        : 'Sufficient headroom. Monitor growth rate weekly.',
    };
  });
}

export function deriveInventory(entities: OpsEntity[]) {
  return entities
    .filter((e) =>
      ['host', 'vm', 'node', 'pod', 'container', 'database', 'queue', 'storage', 'load_balancer'].includes(e.entity_type)
    )
    .map((e) => ({
      id: e.id,
      name: e.name,
      type: e.entity_type,
      platform: e.platform ?? 'On-Prem',
      region: e.region ?? 'us-east-1',
      health: e.health,
    }));
}

export function deriveNetworking(entities: OpsEntity[]) {
  const nets = entities.filter(
    (e) => e.entity_type === 'network' || e.entity_type === 'load_balancer' || e.entity_type === 'gateway'
  );
  if (nets.length === 0) {
    return [
      { id: 'dns-primary', name: 'Internal DNS', type: 'DNS', latencyMs: 2, status: 'healthy' as const },
      { id: 'lb-main', name: 'Main Ingress LB', type: 'Load Balancer', latencyMs: 8, status: 'healthy' as const },
      { id: 'api-gw', name: 'API Gateway', type: 'API Gateway', latencyMs: 12, status: 'warning' as const },
    ];
  }
  return nets.map((n) => ({
    id: n.id,
    name: n.name,
    type: n.entity_type,
    latencyMs: Math.round(Number(n.metrics.latency_p95 ?? 10)),
    status: n.health,
  }));
}

export function deriveRuntime(entities: OpsEntity[]) {
  const runtimes = entities.filter((e) => e.entity_type === 'runtime');
  const jvms = entities.filter((e) => e.id.toLowerCase().includes('tomcat') || e.id.toLowerCase().includes('jvm'));
  const sources = runtimes.length ? runtimes : jvms;
  return sources.map((r) => ({
    id: r.id,
    name: r.name,
    runtime: 'JVM',
    heapPct: Math.round(Number(r.metrics.memory_usage_pct ?? r.metrics.memory ?? 62)),
    threads: Math.round(Number(r.metrics.thread_count ?? 128)),
    gcPauseMs: Math.round(Number(r.metrics.gc_pause_ms ?? 45)),
    health: r.health,
  }));
}

export function deriveDataPlatforms(entities: OpsEntity[]) {
  return deriveDataPipelines(entities).map((p) => ({
    ...p,
    platform: p.type === 'Streaming' ? 'Kafka Streams' : 'Apache Airflow',
  }));
}

export function deriveServerless(entities: OpsEntity[]) {
  const fns = entities.filter((e) => e.entity_type === 'function');
  if (fns.length === 0) {
    return entities
      .filter((e) => e.entity_type === 'microservice')
      .slice(0, 2)
      .map((s) => ({
        id: `fn-${s.id}`,
        name: `${s.name}-handler`,
        provider: 'AWS Lambda',
        invocations: Math.round(Number(s.metrics.throughput ?? 10) * 3600),
        avgDurationMs: Math.round(Number(s.metrics.latency_p95 ?? 120)),
        errors: s.health === 'critical' ? 12 : 0,
        health: s.health,
      }));
  }
  return fns.map((f) => ({
    id: f.id,
    name: f.name,
    provider: f.platform ?? 'AWS Lambda',
    invocations: Math.round(Number(f.metrics.throughput ?? 1000)),
    avgDurationMs: Math.round(Number(f.metrics.latency_p95 ?? 85)),
    errors: f.health === 'critical' ? 5 : 0,
    health: f.health,
  }));
}

export function derivePlatformSecurity(entities: OpsEntity[]) {
  return deriveSecurityFindings(entities).map((s) => ({
    ...s,
    category: 'Vulnerability',
    resource: s.component,
  }));
}

export function derivePlatformCost(entities: OpsEntity[]) {
  const clouds = entities.filter((e) => e.entity_type === 'cloud_account');
  if (clouds.length) {
    return clouds.map((c) => ({
      id: c.id,
      account: c.name,
      provider: c.platform ?? 'AWS',
      monthlySpendUSD: Number(c.metrics.monthly_spend_usd ?? 45000),
      forecastUSD: Number(c.metrics.monthly_spend_usd ?? 45000) * 1.08,
      anomalyUSD: c.health === 'warning' ? 2400 : 0,
    }));
  }
  return deriveCosts(entities).map((c) => ({
    id: c.id,
    account: c.service,
    provider: 'Multi-Cloud',
    monthlySpendUSD: c.monthlyCostUSD,
    forecastUSD: Math.round(c.monthlyCostUSD * 1.05),
    anomalyUSD: c.anomalousIncreaseUSD,
  }));
}

function entityMatches(entity: OpsEntity, value?: string): boolean {
  if (!value) return false;
  const v = value.toLowerCase();
  const id = entity.id.toLowerCase();
  const name = entity.name.toLowerCase();
  return v === id || v === name || v.includes(id) || v.includes(name) || id.includes(v) || name.includes(v);
}

export function filterDeploymentsForEntity(entities: OpsEntity[], entity: OpsEntity) {
  return deriveDeployments(entities).filter((d) => entityMatches(entity, d.service));
}

export function filterSecurityForEntity(entities: OpsEntity[], entity: OpsEntity) {
  return deriveSecurityFindings(entities).filter((s) => entityMatches(entity, s.service));
}

export function filterTracesForEntity(entities: OpsEntity[], entity: OpsEntity) {
  return deriveTraces(entities).filter((t) => entityMatches(entity, t.service));
}

export function deriveEntityEvents(entity: OpsEntity) {
  const isCrit = entity.health === 'critical';
  const isWarn = entity.health === 'warning';
  const base = [
    { id: 'ev-1', time: '2m ago', type: 'Health Check', message: `${entity.name} health evaluated as ${entity.health}` },
    { id: 'ev-2', time: '8m ago', type: 'Metric Poll', message: 'Telemetry collector synced metrics from integrated sources' },
  ];
  if (isCrit || isWarn) {
    base.unshift({
      id: 'ev-0',
      time: 'Just now',
      type: isCrit ? 'Alert' : 'Warning',
      message: isCrit
        ? `Elevated error rate and resource saturation detected on ${entity.name}`
        : `Performance degradation detected on ${entity.name}`,
    });
  }
  return base;
}

export function deriveEntityRunbook(entity: OpsEntity) {
  const steps = [
    { id: 'rb-1', title: 'Validate golden signals', detail: `Check latency, traffic, errors, and saturation for ${entity.name}.` },
    { id: 'rb-2', title: 'Review recent changes', detail: 'Inspect deployments and configuration changes in the last 2 hours.' },
    { id: 'rb-3', title: 'Inspect logs and traces', detail: 'Filter error logs and slow traces scoped to this entity.' },
  ];
  if (entity.entity_type === 'runtime' || entity.name.toLowerCase().includes('tomcat')) {
    steps.push({
      id: 'rb-4',
      title: 'Check JVM / GC pressure',
      detail: 'Review GC pause times and heap usage; restart if Full GC loops persist.',
    });
  }
  if (entity.health === 'critical') {
    steps.push({
      id: 'rb-5',
      title: 'Execute mitigation',
      detail: 'Scale out, restart unhealthy instances, or roll back the last deployment.',
    });
  }
  return steps;
}

export function deriveFallbackLogs(entity: OpsEntity) {
  const host = entity.name;
  const isCrit = entity.health === 'critical';
  const gcPause = Number(entity.metrics.gc_pause_ms ?? 45);
  return [
    {
      timestamp: new Date().toISOString(),
      host,
      log_name: 'catalina.out',
      message: isCrit
        ? `ERROR [${host}] java.lang.OutOfMemoryError: GC overhead limit exceeded`
        : `INFO [${host}] Server startup completed in 4821 ms`,
      severity: isCrit ? ('error' as const) : ('info' as const),
    },
    {
      timestamp: new Date(Date.now() - 120_000).toISOString(),
      host,
      log_name: 'gc.log',
      message: isCrit
        ? `WARN [${host}] Full GC (Allocation Failure) ${gcPause}ms`
        : `INFO [${host}] Young GC pause 12ms`,
      severity: isCrit ? ('error' as const) : ('info' as const),
    },
    {
      timestamp: new Date(Date.now() - 300_000).toISOString(),
      host,
      log_name: 'access.log',
      message: `POST /api/v1/process 200 184ms - worker thread pool active`,
      severity: 'info' as const,
    },
  ];
}

