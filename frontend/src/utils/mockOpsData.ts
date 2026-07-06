// Telemetry derivation utilities — maps backend entity data only; no fabricated fallbacks.

import type { OpsEntity } from '../types/ops';

function num(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function str(value: unknown, fallback = 'N/A'): string {
  if (value === null || value === undefined || value === '') return fallback;
  return String(value);
}

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
  if (!entities.length) return [];
  const svcs = entities.filter((e) => e.entity_type === 'microservice' || e.entity_type === 'service');
  return svcs.map((s) => ({
    id: s.id,
    name: s.name,
    health: s.health as BusinessService['health'],
    availability: num(s.metrics.availability, 0),
    latency_ms: Math.round(num(s.metrics.latency_p95, 0)),
    throughput_rps: num(s.metrics.throughput, 0),
    error_rate_pct: num(s.metrics.error_rate, 0),
    owner: str(s.owner, 'N/A'),
    alertsCount: 0,
    lastDeployment: 'N/A',
    description: str(s.metadata.description, 'N/A'),
  }));
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
  if (!entities.length) return [];
  const svcs = entities.filter((e) => e.entity_type === 'microservice' || e.entity_type === 'service');
  return svcs.map((s) => ({
    id: `app-${s.id}`,
    name: s.name,
    type: str(s.metadata.app_type, 'N/A'),
    language: str(s.metadata.language, 'N/A'),
    instances: num(s.metrics.instances, 0),
    health: s.health as ApplicationInfo['health'],
    latency_p95: Math.round(num(s.metrics.latency_p95, 0)),
    error_rate: num(s.metrics.error_rate, 0),
  }));
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
  if (!entities.length) return [];
  const apis = entities.filter((e) => e.entity_type === 'api');
  return apis.map((a) => ({
    id: a.id,
    path: str(a.metadata.path, 'N/A'),
    method: (str(a.metadata.method, 'GET') as APIEndpoint['method']),
    service: str(a.parent_id, 'N/A'),
    rps: num(a.metrics.throughput, 0),
    p95_latency: Math.round(num(a.metrics.latency_p95, 0)),
    error_rate: num(a.metrics.error_rate, 0),
    status: a.health as APIEndpoint['status'],
  }));
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
  if (!entities.length) return [];
  const queues = entities.filter((e) => e.entity_type === 'queue');
  return queues.map((q) => ({
    id: `w-${q.id}`,
    name: q.name,
    service: str(q.parent_id, 'N/A'),
    status: q.health as WorkerMetric['status'],
    msgRate: num(q.metrics.throughput_msg_s, 0),
    consumerLag: num(q.metrics.consumer_lag ?? q.metrics.queue_depth, 0),
    errorRate: num(q.metrics.error_rate, 0),
    retries: num(q.metrics.retries, 0),
  }));
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
  if (!entities.length) return [];
  const jobs = entities.filter((e) => e.entity_type === 'batch_job' || e.entity_type === 'cronjob');
  return jobs.map((j) => ({
    id: j.id,
    name: j.name,
    schedule: str(j.metadata.schedule, 'N/A'),
    lastRun: str(j.metadata.last_run, 'N/A'),
    durationSec: num(j.metrics.duration_sec, 0),
    status: (str(j.metadata.status, 'success') as BatchJob['status']),
    successRate: num(j.metrics.success_rate, 0),
  }));
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
  if (!entities.length) return [];
  const pipelines = entities.filter((e) => e.entity_type === 'pipeline');
  return pipelines.map((p) => ({
    id: p.id,
    name: p.name,
    type: (str(p.metadata.type, 'Batch') as DataPipeline['type']),
    throughput: num(p.metrics.throughput, 0),
    lagMs: num(p.metrics.latency_p95, 0),
    processingTimeMs: num(p.metrics.processing_time_ms, 0),
    status: p.health as DataPipeline['status'],
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
  if (!entities.length) return [];
  const svcs = entities.filter((e) => e.entity_type === 'ai_service' || e.entity_type === 'model');
  return svcs.map((s) => ({
    id: s.id,
    name: s.name,
    model: str(s.metadata.model, 'N/A'),
    latencyMs: num(s.metrics.latency_p95, 0),
    tokensPerSec: num(s.metrics.tokens_per_sec, 0),
    cacheHitPct: num(s.metrics.cache_hit_pct, 0),
    accuracyScore: num(s.metrics.accuracy_score, 0),
    status: s.health as AIService['status'],
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
  if (!entities.length) return [];
  const txs = entities.filter((e) => e.entity_type === 'transaction');
  return txs.map((t) => ({
    id: t.id,
    name: t.name,
    volume: num(t.metrics.volume, 0),
    completionRate: num(t.metrics.availability, 0),
    avgLatencyMs: Math.round(num(t.metrics.latency_p95, 0)),
    dropOffRate: num(t.metrics.drop_off_rate, 0),
    status: t.health as BusinessTransaction['status'],
  }));
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
  if (!entities.length) return [];
  const slos = entities.filter((e) => e.entity_type === 'slo');
  if (slos.length) {
    return slos.map((s) => ({
      id: s.id,
      name: s.name,
      target: str(s.metadata.target, 'N/A'),
      current: num(s.metrics.current, 0),
      errorBudgetRemaining: num(s.metrics.error_budget_remaining, 0),
      burnRate: num(s.metrics.burn_rate, 0),
      status: (str(s.metadata.status, 'compliant') as SLO['status']),
    }));
  }
  const svcs = entities.filter((e) => e.entity_type === 'microservice' || e.entity_type === 'service');
  return svcs.map((s) => ({
    id: `slo-${s.id}`,
    name: `Availability SLO: ${s.name}`,
    target: 'N/A',
    current: num(s.metrics.availability, 0),
    errorBudgetRemaining: 0,
    burnRate: num(s.metrics.error_rate, 0),
    status: s.health === 'critical' ? 'breached' : s.health === 'warning' ? 'warning' : 'compliant',
  }));
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
  if (!entities.length) return [];
  const deps = entities.filter((e) => e.entity_type === 'deployment');
  return deps.map((d) => ({
    id: d.id,
    version: str(d.metadata.version, 'N/A'),
    service: str(d.metadata.service ?? d.parent_id, 'N/A'),
    timestamp: str(d.metadata.timestamp, 'N/A'),
    deployedBy: str(d.metadata.deployed_by, 'N/A'),
    status: (str(d.metadata.status, 'success') as DeploymentEvent['status']),
    changeImpact: str(d.metadata.change_impact, 'N/A'),
  }));
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
  if (!entities.length) return [];
  const findings = entities.filter((e) => e.entity_type === 'security_finding' || e.entity_type === 'vulnerability');
  return findings.map((f) => ({
    id: f.id,
    cve: str(f.metadata.cve, 'N/A'),
    service: str(f.metadata.service ?? f.parent_id, 'N/A'),
    severity: (str(f.metadata.severity, 'medium') as SecurityFinding['severity']),
    component: str(f.metadata.component, 'N/A'),
    status: (str(f.metadata.status, 'open') as SecurityFinding['status']),
    description: str(f.metadata.description, 'N/A'),
  }));
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
  if (!entities.length) return [];
  const costs = entities.filter((e) => e.entity_type === 'cost' || e.entity_type === 'billing');
  if (costs.length) {
    return costs.map((c) => ({
      id: c.id,
      service: c.name,
      monthlyCostUSD: num(c.metrics.monthly_cost_usd, 0),
      computeCostUSD: num(c.metrics.compute_cost_usd, 0),
      dbCostUSD: num(c.metrics.db_cost_usd, 0),
      idleWastedUSD: num(c.metrics.idle_wasted_usd, 0),
      anomalousIncreaseUSD: num(c.metrics.anomalous_increase_usd, 0),
    }));
  }
  return [];
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
  if (!entities.length) return [];
  const traces = entities.filter((e) => e.entity_type === 'trace');
  if (traces.length) {
    return traces.map((t) => ({
      id: t.id,
      rootPath: str(t.metadata.root_path, 'N/A'),
      service: str(t.metadata.service ?? t.parent_id, 'N/A'),
      durationMs: Math.round(num(t.metrics.latency_p95, 0)),
      timestamp: str(t.metadata.timestamp, 'N/A'),
      status: (str(t.metadata.status, 'ok') as Trace['status']),
      spans: [],
    }));
  }
  return [];
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
  if (!entities.length) return [];
  const hosts = entities.filter(
    (e) =>
      ['host', 'vm', 'node'].includes(e.entity_type) ||
      e.id.includes('host') ||
      e.id.includes('node') ||
      e.id.includes('vm')
  );
  return hosts.map((h) => {
    const cpu = num(h.metrics.cpu_usage ?? h.metrics.cpu, 0);
    const mem = num(h.metrics.memory_usage ?? h.metrics.memory, 0);
    const load = num(h.metrics.load_avg_5m, 0);
    let prov: ComputeHost['provider'] = 'Physical';
    const platform = (h.platform ?? '').toLowerCase();
    if (platform.includes('aws')) prov = 'AWS';
    else if (platform.includes('azure')) prov = 'Azure';
    else if (platform.includes('gcp')) prov = 'GCP';
    else if (platform.includes('vmware')) prov = 'VMware';

    return {
      id: h.id,
      name: h.name,
      provider: prov,
      type: str(h.metadata.instance_type, 'N/A'),
      ip: str(h.metadata.ip, 'N/A'),
      cpuUsagePct: Math.round(cpu),
      memoryUsagePct: Math.round(mem),
      loadAvg: load > 0 ? `${load.toFixed(2)}` : 'N/A',
      health: h.health as ComputeHost['health'],
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
  if (!entities.length) return [];
  const pods = entities.filter((e) => e.entity_type === 'pod');
  return pods.map((p) => ({
    id: p.id,
    name: p.name,
    namespace: str(p.metadata.namespace, 'N/A'),
    node: str(p.metadata.node, 'N/A'),
    status: str(p.metadata.status, 'N/A'),
    memLimitUsage: Math.round(num(p.metrics.memory_usage_pct, 0)),
    restarts: num(p.metrics.restarts, 0),
    health: p.health as K8sPod['health'],
  }));
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
  if (!entities.length) return [];
  const accounts = entities.filter((e) => e.entity_type === 'cloud_account');
  return accounts.map((a) => ({
    id: a.id,
    accountName: a.name,
    provider: (str(a.platform, 'AWS') as CloudAccount['provider']),
    status: (str(a.metadata.status, 'active') as CloudAccount['status']),
    regionsActive: num(a.metrics.regions_active, 0),
    monthlySpendUSD: num(a.metrics.monthly_spend_usd, 0),
  }));
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
  if (!entities.length) return [];
  const hosts = entities.filter((e) => e.entity_type === 'vm' || e.platform === 'on-prem-vmware');
  return hosts.map((h) => ({
    id: h.id,
    name: h.name,
    hypervisor: str(h.metadata.hypervisor, 'N/A'),
    vmsCount: num(h.metrics.vms_count, 0),
    cpuOvercommit: num(h.metrics.cpu_overcommit, 0),
    memOvercommit: num(h.metrics.mem_overcommit, 0),
    diskPoolUsagePct: num(h.metrics.disk_pool_usage_pct, 0),
    status: h.health as VirtHost['status'],
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
  if (!entities.length) return [];
  const vls = entities.filter(
    (e) => e.entity_type === 'storage' || e.id.includes('disk') || e.id.includes('volume') || e.id.includes('storage')
  );
  return vls.map((v) => ({
    id: v.id,
    name: v.name,
    type: str(v.metadata.volume_type, 'N/A'),
    capacityTotalGB: Math.round(num(v.metrics.size_gb, 0)),
    capacityUsedPct: Math.round(num(v.metrics.usage_pct, 0)),
    readIOPS: num(v.metrics.read_iops, 0),
    writeIOPS: num(v.metrics.write_iops, 0),
    health: v.health as StorageVolume['health'],
  }));
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
  if (!entities.length) return [];
  const dbs = entities.filter((e) => e.entity_type === 'database');
  return dbs.map((d) => ({
    id: d.id,
    name: d.name,
    engine: str(d.metadata.engine, 'N/A'),
    connectionsActive: num(d.metrics.connections, 0),
    locksCount: num(d.metrics.locks, 0),
    deadlocksCount: num(d.metrics.deadlocks, 0),
    avgQueryTimeMs: num(d.metrics.query_latency_ms ?? d.metrics.latency_p95, 0),
    slowQueriesCount: num(d.metrics.slow_queries, 0),
    health: d.health as DatabaseAsset['health'],
  }));
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
  if (!entities.length) return [];
  const msgs = entities.filter((e) => e.entity_type === 'queue');
  return msgs.map((m) => ({
    id: m.id,
    name: m.name,
    type: str(m.metadata.broker_type, 'N/A'),
    topicsCount: num(m.metadata.queues_count, 0),
    msgRateIn: num(m.metrics.throughput_msg_s, 0),
    msgRateOut: num(m.metrics.throughput_msg_s, 0),
    consumerLag: num(m.metrics.consumer_lag ?? m.metrics.queue_depth, 0),
    dlqDepth: num(m.metrics.dlq_depth, 0),
    health: m.health as MessagingAsset['health'],
  }));
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
  if (!entities.length) return [];
  const forecasts = entities.filter((e) => e.entity_type === 'capacity_forecast');
  if (forecasts.length) {
    return forecasts.map((f) => ({
      id: f.id,
      resourceName: f.name,
      resourceType: str(f.metadata.resource_type, 'N/A'),
      currentUsagePct: num(f.metrics.current_usage_pct, 0),
      growthRatePctPerWeek: num(f.metrics.growth_rate_pct, 0),
      daysToExhaustion: num(f.metrics.days_to_exhaustion, 0),
      recommendation: str(f.metadata.recommendation, 'N/A'),
    }));
  }
  return [];
}

export function deriveInventory(entities: OpsEntity[]) {
  if (!entities.length) return [];
  return entities
    .filter((e) =>
      ['host', 'vm', 'node', 'pod', 'container', 'database', 'queue', 'storage', 'load_balancer'].includes(e.entity_type)
    )
    .map((e) => ({
      id: e.id,
      name: e.name,
      type: e.entity_type,
      platform: e.platform ?? 'N/A',
      region: e.region ?? 'N/A',
      health: e.health,
    }));
}

export function deriveNetworking(entities: OpsEntity[]) {
  if (!entities.length) return [];
  const nets = entities.filter(
    (e) => e.entity_type === 'network' || e.entity_type === 'load_balancer' || e.entity_type === 'gateway'
  );
  return nets.map((n) => ({
    id: n.id,
    name: n.name,
    type: n.entity_type,
    latencyMs: Math.round(num(n.metrics.latency_p95, 0)),
    status: n.health,
  }));
}

export function deriveRuntime(entities: OpsEntity[]) {
  if (!entities.length) return [];
  const runtimes = entities.filter((e) => e.entity_type === 'runtime');
  return runtimes.map((r) => ({
    id: r.id,
    name: r.name,
    runtime: str(r.metadata.runtime, 'N/A'),
    heapPct: Math.round(num(r.metrics.memory_usage_pct ?? r.metrics.memory, 0)),
    threads: Math.round(num(r.metrics.thread_count, 0)),
    gcPauseMs: Math.round(num(r.metrics.gc_pause_ms, 0)),
    health: r.health,
  }));
}

export function deriveDataPlatforms(entities: OpsEntity[]) {
  return deriveDataPipelines(entities).map((p) => ({
    ...p,
    platform: str(p.type, 'N/A'),
  }));
}

export function deriveServerless(entities: OpsEntity[]) {
  if (!entities.length) return [];
  const fns = entities.filter((e) => e.entity_type === 'function');
  return fns.map((f) => ({
    id: f.id,
    name: f.name,
    provider: str(f.platform, 'N/A'),
    invocations: num(f.metrics.throughput, 0),
    avgDurationMs: Math.round(num(f.metrics.latency_p95, 0)),
    errors: num(f.metrics.errors, 0),
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
      provider: c.platform ?? 'N/A',
      monthlySpendUSD: num(c.metrics.monthly_spend_usd, 0),
      forecastUSD: num(c.metrics.monthly_spend_usd, 0),
      anomalyUSD: 0,
    }));
  }
  return deriveCosts(entities).map((c) => ({
    id: c.id,
    account: c.service,
    provider: 'N/A',
    monthlySpendUSD: c.monthlyCostUSD,
    forecastUSD: 0,
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

export interface EntityEvent {
  id: string;
  time: string;
  type: string;
  message: string;
}

export interface EntityRunbookStep {
  id: string;
  title: string;
  detail: string;
}

export function deriveEntityEvents(_entity: OpsEntity): EntityEvent[] {
  return [];
}

export function deriveEntityRunbook(_entity: OpsEntity): EntityRunbookStep[] {
  return [];
}

export function deriveFallbackLogs(_entity: OpsEntity) {
  return [];
}
