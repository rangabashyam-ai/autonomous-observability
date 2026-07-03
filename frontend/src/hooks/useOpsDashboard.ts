import { useCallback, useEffect, useState } from 'react';
import { getOpsCatalog, getOpsDashboard, getOpsEntities } from '../api/client';
import type { OpsCatalog, OpsDashboardDefinition, OpsDashboardId, OpsEntity } from '../types/ops';

export function useOpsDashboard(dashboardId: OpsDashboardId) {
  const [catalog, setCatalog] = useState<OpsCatalog | null>(null);
  const [dashboard, setDashboard] = useState<OpsDashboardDefinition | null>(null);
  const [entities, setEntities] = useState<OpsEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState('overview');

  const perspective = dashboardId === 'service-ops' ? 'service' : 'platform';

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      getOpsCatalog(),
      getOpsDashboard(dashboardId),
      getOpsEntities({ perspective }),
    ])
      .then(([cat, dash, ent]) => {
        setCatalog(cat);
        setDashboard(dash);
        setEntities(ent.entities);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load operations data'))
      .finally(() => setLoading(false));
  }, [dashboardId, perspective]);

  useEffect(() => {
    reload();
  }, [reload]);

  const navItems =
    dashboardId === 'service-ops'
      ? catalog?.service_nav ?? dashboard?.sections.map((s) => ({ id: s.id, label: s.label })) ?? []
      : catalog?.platform_nav ?? dashboard?.sections.map((s) => ({ id: s.id, label: s.label })) ?? [];

  const currentSection = dashboard?.sections.find((s) => s.id === activeSection);

  return {
    catalog,
    dashboard,
    entities,
    loading,
    error,
    activeSection,
    setActiveSection,
    navItems,
    currentSection,
    reload,
    perspective,
  };
}
