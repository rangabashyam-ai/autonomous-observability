import { useEffect, useState } from 'react';
import { getOpsCatalog } from '../api/client';
import type { OpsCatalog } from '../types/ops';
import { PageHeader, Grid12 } from '../components/ui/layout-primitives';
import { Card, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';

export default function OpsConfigurationPage() {
  const [catalog, setCatalog] = useState<OpsCatalog | null>(null);

  useEffect(() => {
    getOpsCatalog().then(setCatalog).catch(console.error);
  }, []);

  if (!catalog) {
    return <p className="text-text-secondary text-sm">Loading operations catalog...</p>;
  }

  const serviceTypes = catalog.entity_types.filter((t) => t.perspective === 'service');
  const platformTypes = catalog.entity_types.filter((t) => t.perspective === 'platform');

  return (
    <div>
      <PageHeader
        title="Enterprise Operations Catalog"
        description="Unified entity model, integrations, and navigation for Service Operations and Platform Operations."
      />

      <Grid12 className="mb-6">
        <div className="col-span-12 lg:col-span-6">
          <Card>
            <CardHeader><CardTitle>Service Entity Types ({serviceTypes.length})</CardTitle></CardHeader>
            <div className="flex flex-wrap gap-2 px-5 pb-5">
              {serviceTypes.map((t) => (
                <Badge key={t.id} variant="default">{t.label}</Badge>
              ))}
            </div>
          </Card>
        </div>
        <div className="col-span-12 lg:col-span-6">
          <Card>
            <CardHeader><CardTitle>Platform Entity Types ({platformTypes.length})</CardTitle></CardHeader>
            <div className="flex flex-wrap gap-2 px-5 pb-5">
              {platformTypes.map((t) => (
                <Badge key={t.id} variant="default">{t.label}</Badge>
              ))}
            </div>
          </Card>
        </div>
      </Grid12>

      <Card>
        <CardHeader><CardTitle>Supported Integrations ({catalog.integrations.length})</CardTitle></CardHeader>
        <div className="flex flex-wrap gap-2 px-5 pb-5">
          {catalog.integrations.map((name) => (
            <Badge key={name} variant="default">{name}</Badge>
          ))}
        </div>
      </Card>
    </div>
  );
}
