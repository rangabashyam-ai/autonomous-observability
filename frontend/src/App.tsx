import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import Layout from './components/Layout';

const ExecutiveCommandCenter = lazy(() => import('./pages/ExecutiveCommandCenter'));
const ServiceOperationsCenter = lazy(() => import('./pages/ServiceOperationsCenter'));
const TechnicalPlatformView = lazy(() => import('./pages/TechnicalPlatformView'));
import AIOperationsCopilot from './pages/AIOperationsCopilot';
import DependencyMapPage from './pages/DependencyMapPage';
import IncidentExplorer from './pages/IncidentExplorer';
import RCADashboard from './pages/RCADashboard';
import BlastRadiusDashboard from './pages/BlastRadiusDashboard';
import EarlyDetectionDashboard from './pages/EarlyDetectionDashboard';
import InvestigationWorkflow from './pages/InvestigationWorkflow';
import DataAdminPage from './pages/DataAdminPage';
import ServiceDetailPage from './pages/ServiceDetailPage';
import CloudIntegrationsPage from './pages/CloudIntegrationsPage';
import SettingsPage from './pages/SettingsPage';
import OpsConfigurationPage from './pages/OpsConfigurationPage';
import DistributedTracesPage from './pages/DistributedTracesPage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route
            index
            element={
              <Suspense fallback={<p className="text-text-secondary text-sm">Loading executive command center...</p>}>
                <ExecutiveCommandCenter />
              </Suspense>
            }
          />
          <Route
            path="operations"
            element={
              <Suspense fallback={<p className="text-text-secondary text-sm">Loading service operations center...</p>}>
                <ServiceOperationsCenter />
              </Suspense>
            }
          />
          <Route
            path="platform"
            element={
              <Suspense fallback={<p className="text-text-secondary text-sm">Loading platform operations view...</p>}>
                <TechnicalPlatformView />
              </Suspense>
            }
          />
          <Route path="copilot" element={<AIOperationsCopilot />} />
          {/* Drilldown routes */}
          <Route path="services/:serviceId" element={<ServiceDetailPage />} />
          {/* Legacy redirects */}
          <Route path="monitoring" element={<Navigate to="/operations" replace />} />
          <Route path="dependencies" element={<DependencyMapPage />} />
          <Route path="traces" element={<DistributedTracesPage />} />
          <Route path="incidents" element={<IncidentExplorer />} />
          <Route path="rca" element={<RCADashboard />} />
          <Route path="blast-radius" element={<BlastRadiusDashboard />} />
          <Route path="early-detection" element={<EarlyDetectionDashboard />} />
          <Route path="investigation" element={<InvestigationWorkflow />} />
          <Route path="admin" element={<DataAdminPage />} />
          <Route path="integrations" element={<CloudIntegrationsPage />} />
          <Route path="ops-config" element={<OpsConfigurationPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
