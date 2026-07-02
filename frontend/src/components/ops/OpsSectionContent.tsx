import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import { Card, CardHeader, CardTitle } from '../ui/card';
import { DataTable, HealthBadge } from '../ui/data-table';
import OpsSectionShell from './OpsSectionShell';
import type { OpsDashboardSection, OpsEntity } from '../../types/ops';
import {
  deriveAIServices,
  deriveAPIs,
  deriveApplications,
  deriveBatchJobs,
  deriveBusinessServices,
  deriveCapacityForecasts,
  deriveCloudAccounts,
  deriveComputeHosts,
  deriveCosts,
  deriveDataPlatforms,
  deriveDataPipelines,
  deriveDatabases,
  deriveDeployments,
  deriveInventory,
  deriveK8sPods,
  deriveMessaging,
  deriveNetworking,
  derivePlatformCost,
  derivePlatformSecurity,
  deriveRuntime,
  deriveSecurityFindings,
  deriveServerless,
  deriveSLOs,
  deriveStorageVolumes,
  deriveTraces,
  deriveTransactions,
  deriveVirtHosts,
  deriveWorkers,
} from '../../utils/mockOpsData';

interface OpsSectionContentProps {
  section: OpsDashboardSection;
  entities: OpsEntity[];
  onEntityClick?: (entity: OpsEntity) => void;
}

type Row = Record<string, unknown> & { id: string };

function findEntity(entities: OpsEntity[], row: Row): OpsEntity | undefined {
  const rowId = String(row.id ?? '');
  const rowName = String(row.name ?? row.service ?? '');
  const bareId = rowId.replace(/^(app|svc|api|host|pod|db|queue|cache|node|vm|fn|pipeline|job|worker|gateway|runtime|storage|lb|network|container|frontend|ai)-/i, '');

  return (
    entities.find((e) => e.id === rowId) ||
    entities.find((e) => e.id === bareId) ||
    entities.find((e) => e.name === rowName) ||
    entities.find((e) => e.name === rowId) ||
    entities.find((e) => rowId.includes(e.id)) ||
    entities.find((e) => rowName.includes(e.name))
  );
}

function EntityTable({
  section,
  rows,
  columns,
  entities,
  onEntityClick,
}: {
  section: OpsDashboardSection;
  rows: Row[];
  columns: { key: string; header: string; render?: (row: Row) => ReactNode }[];
  entities: OpsEntity[];
  onEntityClick?: (entity: OpsEntity) => void;
}) {
  const tableTitle = section.widgets[0]?.title ?? section.label;

  if (rows.length === 0) {
    return (
      <OpsSectionShell section={section} rows={rows}>
        <Card>
          <CardHeader><CardTitle>{tableTitle}</CardTitle></CardHeader>
          <p className="px-5 pb-5 text-sm text-text-secondary">No entities in this category yet. Connect integrations to populate inventory.</p>
        </Card>
      </OpsSectionShell>
    );
  }

  return (
    <OpsSectionShell section={section} rows={rows} chartSeed={rows.length * 11}>
      <Card padding={false} className="overflow-hidden shadow-sm">
        <div className="px-5 pt-5 pb-3 border-b border-border bg-card-hover/30">
          <CardHeader className="mb-0">
            <CardTitle>{tableTitle}</CardTitle>
          </CardHeader>
          <p className="text-[10px] text-text-secondary mt-1">{rows.length} records · click a row to open entity drawer</p>
        </div>
        <DataTable
          compact
          className="pb-1"
          data={rows}
          onRowClick={
            onEntityClick
              ? (row) => {
                  const ent = findEntity(entities, row);
                  if (ent) onEntityClick(ent);
                }
              : undefined
          }
          columns={columns.map((c) => ({
            key: c.key,
            header: c.header,
            render: c.render ?? ((row: Row) => <span className="text-xs">{String(row[c.key] ?? '—')}</span>),
          }))}
        />
      </Card>
    </OpsSectionShell>
  );
}

export default function OpsSectionContent({ section, entities, onEntityClick }: OpsSectionContentProps) {
  const widget = section.widgets[0];
  const key = widget?.derive_key ?? section.id;

  if (section.id === 'dependencies') {
    const rows = entities.map((e) => ({ id: e.id, health: e.health }));
    return (
      <OpsSectionShell section={section} rows={rows} chartSeed={entities.length * 5}>
        <Card className="shadow-sm">
          <CardHeader><CardTitle>Service Dependencies</CardTitle></CardHeader>
          <p className="px-5 pb-3 text-sm text-text-secondary">
            Interactive service topology and blast-radius analysis live in the Dependency Map.
          </p>
          <div className="px-5 pb-5">
            <Link to="/dependencies" className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline">
              Open Dependency Map →
            </Link>
          </div>
        </Card>
      </OpsSectionShell>
    );
  }

  if (section.id === 'incidents') {
    const rows = entities.filter((e) => e.health !== 'healthy').map((e) => ({ id: e.id, health: e.health }));
    return (
      <OpsSectionShell section={section} rows={rows} chartSeed={42}>
        <Card className="shadow-sm">
          <CardHeader><CardTitle>Incidents</CardTitle></CardHeader>
          <p className="px-5 pb-3 text-sm text-text-secondary">
            Active and historical incidents correlated to services and platform entities.
          </p>
          <div className="px-5 pb-5">
            <Link to="/incidents" className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline">
              Open Incident Explorer →
            </Link>
          </div>
        </Card>
      </OpsSectionShell>
    );
  }

  const healthCol = {
    key: 'health',
    header: 'Health',
    render: (r: Row) => <HealthBadge health={(r.health ?? r.status) as 'healthy' | 'warning' | 'critical'} />,
  };

  const statusCol = {
    key: 'status',
    header: 'Status',
    render: (r: Row) => <HealthBadge health={(r.status ?? r.health) as 'healthy' | 'warning' | 'critical'} />,
  };

  switch (key) {
    case 'business_services': {
      const rows = deriveBusinessServices(entities);
      return (
        <EntityTable section={section} rows={rows}
          entities={entities}
          onEntityClick={onEntityClick}
          columns={[
            { key: 'name', header: 'Service' },
            { key: 'availability', header: 'Availability', render: (r) => <span className="font-mono text-xs">{r.availability}%</span> },
            { key: 'latency_ms', header: 'P99', render: (r) => <span className="font-mono text-xs">{r.latency_ms}ms</span> },
            { key: 'error_rate_pct', header: 'Errors', render: (r) => <span className="font-mono text-xs">{r.error_rate_pct}%</span> },
            { key: 'owner', header: 'Owner' },
            healthCol,
          ]}
        />
      );
    }
    case 'applications': {
      const rows = deriveApplications(entities);
      return (
        <EntityTable section={section} rows={rows}
          entities={entities}
          onEntityClick={onEntityClick}
          columns={[
            { key: 'name', header: 'Application' },
            { key: 'type', header: 'Type' },
            { key: 'language', header: 'Runtime' },
            { key: 'instances', header: 'Instances', render: (r) => <span className="font-mono text-xs">{r.instances}</span> },
            { key: 'latency_p95', header: 'P95', render: (r) => <span className="font-mono text-xs">{r.latency_p95}ms</span> },
            healthCol,
          ]}
        />
      );
    }
    case 'apis': {
      const rows = deriveAPIs(entities);
      return (
        <EntityTable section={section} rows={rows}
          entities={entities}
          onEntityClick={onEntityClick}
          columns={[
            { key: 'path', header: 'Path' },
            { key: 'method', header: 'Method' },
            { key: 'rps', header: 'RPS', render: (r) => <span className="font-mono text-xs">{r.rps}</span> },
            { key: 'p95_latency', header: 'P95', render: (r) => <span className="font-mono text-xs">{r.p95_latency}ms</span> },
            statusCol,
          ]}
        />
      );
    }
    case 'workers': {
      const rows = deriveWorkers(entities);
      return (
        <EntityTable section={section} rows={rows} entities={entities} onEntityClick={onEntityClick} columns={[
          { key: 'name', header: 'Worker' }, { key: 'msgRate', header: 'Msg/s' }, { key: 'consumerLag', header: 'Lag' }, statusCol,
        ]} />
      );
    }
    case 'batch_jobs': {
      const rows = deriveBatchJobs(entities);
      return (
        <EntityTable section={section} rows={rows} entities={entities} onEntityClick={onEntityClick} columns={[
          { key: 'name', header: 'Job' }, { key: 'schedule', header: 'Schedule' }, { key: 'lastRun', header: 'Last Run' }, { key: 'status', header: 'Status' },
        ]} />
      );
    }
    case 'pipelines': {
      const rows = deriveDataPipelines(entities);
      return (
        <EntityTable section={section} rows={rows} entities={entities} onEntityClick={onEntityClick} columns={[
          { key: 'name', header: 'Pipeline' }, { key: 'type', header: 'Type' }, { key: 'throughput', header: 'Throughput' }, statusCol,
        ]} />
      );
    }
    case 'ai_services': {
      const rows = deriveAIServices(entities);
      return (
        <EntityTable section={section} rows={rows} entities={entities} onEntityClick={onEntityClick} columns={[
          { key: 'name', header: 'Service' }, { key: 'model', header: 'Model' }, { key: 'latencyMs', header: 'Latency' }, statusCol,
        ]} />
      );
    }
    case 'transactions': {
      const rows = deriveTransactions(entities);
      return (
        <EntityTable section={section} rows={rows} entities={entities} onEntityClick={onEntityClick} columns={[
          { key: 'name', header: 'Transaction' }, { key: 'volume', header: 'Volume' }, { key: 'completionRate', header: 'Completion %' }, statusCol,
        ]} />
      );
    }
    case 'traces': {
      const rows = deriveTraces(entities);
      return (
        <EntityTable section={section} rows={rows} entities={entities} onEntityClick={onEntityClick} columns={[
          { key: 'rootPath', header: 'Operation' }, { key: 'service', header: 'Service' }, { key: 'durationMs', header: 'Duration' }, { key: 'status', header: 'Status' },
        ]} />
      );
    }
    case 'slos': {
      const rows = deriveSLOs(entities);
      return (
        <EntityTable section={section} rows={rows} entities={entities} onEntityClick={onEntityClick} columns={[
          { key: 'name', header: 'SLO' }, { key: 'target', header: 'Target' }, { key: 'current', header: 'Current' }, { key: 'burnRate', header: 'Burn Rate' }, { key: 'status', header: 'Status' },
        ]} />
      );
    }
    case 'deployments': {
      const rows = deriveDeployments(entities);
      return (
        <EntityTable section={section} rows={rows} entities={entities} onEntityClick={onEntityClick} columns={[
          { key: 'service', header: 'Service' }, { key: 'version', header: 'Version' }, { key: 'timestamp', header: 'When' }, { key: 'status', header: 'Status' },
        ]} />
      );
    }
    case 'security': {
      const rows = deriveSecurityFindings(entities);
      return (
        <EntityTable section={section} rows={rows} entities={entities} onEntityClick={onEntityClick} columns={[
          { key: 'cve', header: 'CVE' }, { key: 'service', header: 'Service' }, { key: 'severity', header: 'Severity' }, { key: 'status', header: 'Status' },
        ]} />
      );
    }
    case 'costs': {
      const rows = deriveCosts(entities);
      return (
        <EntityTable section={section} rows={rows} entities={entities} onEntityClick={onEntityClick} columns={[
          { key: 'service', header: 'Service' }, { key: 'monthlyCostUSD', header: 'Monthly $' }, { key: 'idleWastedUSD', header: 'Idle Waste' },
        ]} />
      );
    }
    case 'inventory': {
      const rows = deriveInventory(entities);
      return (
        <EntityTable section={section} rows={rows} entities={entities} onEntityClick={onEntityClick} columns={[
          { key: 'name', header: 'Resource' }, { key: 'type', header: 'Type' }, { key: 'platform', header: 'Platform' }, { key: 'region', header: 'Region' }, healthCol,
        ]} />
      );
    }
    case 'compute_hosts': {
      const rows = deriveComputeHosts(entities);
      return (
        <EntityTable section={section} rows={rows} entities={entities} onEntityClick={onEntityClick} columns={[
          { key: 'name', header: 'Host' }, { key: 'provider', header: 'Provider' }, { key: 'cpuUsagePct', header: 'CPU %' }, { key: 'memoryUsagePct', header: 'Memory %' }, healthCol,
        ]} />
      );
    }
    case 'k8s_pods': {
      const rows = deriveK8sPods(entities);
      return (
        <EntityTable section={section} rows={rows} entities={entities} onEntityClick={onEntityClick} columns={[
          { key: 'name', header: 'Pod' }, { key: 'namespace', header: 'Namespace' }, { key: 'node', header: 'Node' }, { key: 'status', header: 'Status' }, healthCol,
        ]} />
      );
    }
    case 'cloud_accounts': {
      const rows = deriveCloudAccounts(entities);
      return (
        <EntityTable section={section} rows={rows} entities={entities} onEntityClick={onEntityClick} columns={[
          { key: 'accountName', header: 'Account' }, { key: 'provider', header: 'Provider' }, { key: 'regionsActive', header: 'Regions' }, { key: 'monthlySpendUSD', header: 'Spend/mo' },
        ]} />
      );
    }
    case 'virtualization': {
      const rows = deriveVirtHosts(entities);
      return (
        <EntityTable section={section} rows={rows} entities={entities} onEntityClick={onEntityClick} columns={[
          { key: 'name', header: 'Hypervisor' }, { key: 'hypervisor', header: 'Platform' }, { key: 'vmsCount', header: 'VMs' }, statusCol,
        ]} />
      );
    }
    case 'networking': {
      const rows = deriveNetworking(entities);
      return (
        <EntityTable section={section} rows={rows} entities={entities} onEntityClick={onEntityClick} columns={[
          { key: 'name', header: 'Resource' }, { key: 'type', header: 'Type' }, { key: 'latencyMs', header: 'Latency' }, statusCol,
        ]} />
      );
    }
    case 'storage': {
      const rows = deriveStorageVolumes(entities);
      return (
        <EntityTable section={section} rows={rows} entities={entities} onEntityClick={onEntityClick} columns={[
          { key: 'name', header: 'Volume' }, { key: 'type', header: 'Type' }, { key: 'capacityUsedPct', header: 'Used %' }, healthCol,
        ]} />
      );
    }
    case 'runtime': {
      const rows = deriveRuntime(entities);
      return (
        <EntityTable section={section} rows={rows} entities={entities} onEntityClick={onEntityClick} columns={[
          { key: 'name', header: 'Runtime' }, { key: 'heapPct', header: 'Heap %' }, { key: 'threads', header: 'Threads' }, { key: 'gcPauseMs', header: 'GC Pause' }, healthCol,
        ]} />
      );
    }
    case 'databases': {
      const rows = deriveDatabases(entities);
      return (
        <EntityTable section={section} rows={rows} entities={entities} onEntityClick={onEntityClick} columns={[
          { key: 'name', header: 'Database' }, { key: 'engine', header: 'Engine' }, { key: 'connectionsActive', header: 'Connections' }, { key: 'avgQueryTimeMs', header: 'Query ms' }, healthCol,
        ]} />
      );
    }
    case 'messaging': {
      const rows = deriveMessaging(entities);
      return (
        <EntityTable section={section} rows={rows} entities={entities} onEntityClick={onEntityClick} columns={[
          { key: 'name', header: 'Broker' }, { key: 'type', header: 'Type' }, { key: 'consumerLag', header: 'Lag' }, healthCol,
        ]} />
      );
    }
    case 'data_platforms': {
      const rows = deriveDataPlatforms(entities);
      return (
        <EntityTable section={section} rows={rows} entities={entities} onEntityClick={onEntityClick} columns={[
          { key: 'name', header: 'Platform' }, { key: 'platform', header: 'Technology' }, { key: 'throughput', header: 'Throughput' }, statusCol,
        ]} />
      );
    }
    case 'serverless': {
      const rows = deriveServerless(entities);
      return (
        <EntityTable section={section} rows={rows} entities={entities} onEntityClick={onEntityClick} columns={[
          { key: 'name', header: 'Function' }, { key: 'provider', header: 'Provider' }, { key: 'invocations', header: 'Invocations' }, healthCol,
        ]} />
      );
    }
    case 'platform_security': {
      const rows = derivePlatformSecurity(entities);
      return (
        <EntityTable section={section} rows={rows} entities={entities} onEntityClick={onEntityClick} columns={[
          { key: 'cve', header: 'Finding' }, { key: 'category', header: 'Category' }, { key: 'severity', header: 'Severity' }, { key: 'status', header: 'Status' },
        ]} />
      );
    }
    case 'platform_cost': {
      const rows = derivePlatformCost(entities);
      return (
        <EntityTable section={section} rows={rows} entities={entities} onEntityClick={onEntityClick} columns={[
          { key: 'account', header: 'Account' }, { key: 'provider', header: 'Provider' }, { key: 'monthlySpendUSD', header: 'Spend' }, { key: 'forecastUSD', header: 'Forecast' },
        ]} />
      );
    }
    case 'capacity_charts':
    case 'platform_score': {
      const forecasts = deriveCapacityForecasts(entities);
      return (
        <EntityTable section={section} rows={forecasts}
          entities={entities}
          onEntityClick={onEntityClick}
          columns={[
            { key: 'resourceName', header: 'Resource' },
            { key: 'currentUsagePct', header: 'Usage %' },
            { key: 'daysToExhaustion', header: 'Days Left' },
            { key: 'recommendation', header: 'Recommendation' },
          ]}
        />
      );
    }
    default:
      return (
        <Card>
          <CardHeader><CardTitle>{section.label}</CardTitle></CardHeader>
          <p className="px-5 pb-5 text-sm text-text-secondary">{section.description ?? 'Section content loads from the enterprise entity catalog.'}</p>
        </Card>
      );
  }
}
