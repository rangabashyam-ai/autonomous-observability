import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import ExecutiveCommandCenter from './pages/ExecutiveCommandCenter';
import ServiceOperationsCenter from './pages/ServiceOperationsCenter';
import TechnicalPlatformView from './pages/TechnicalPlatformView';
import AIOperationsCopilot from './pages/AIOperationsCopilot';
import DependencyMapPage from './pages/DependencyMapPage';
import IncidentExplorer from './pages/IncidentExplorer';
import RCADashboard from './pages/RCADashboard';
import BlastRadiusDashboard from './pages/BlastRadiusDashboard';
import EarlyDetectionDashboard from './pages/EarlyDetectionDashboard';
import InvestigationWorkflow from './pages/InvestigationWorkflow';
import DataAdminPage from './pages/DataAdminPage';
import ServiceDetailPage from './pages/ServiceDetailPage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<ExecutiveCommandCenter />} />
          <Route path="operations" element={<ServiceOperationsCenter />} />
          <Route path="platform" element={<TechnicalPlatformView />} />
          <Route path="copilot" element={<AIOperationsCopilot />} />
          {/* Drilldown routes */}
          <Route path="services/:serviceId" element={<ServiceDetailPage />} />
          {/* Legacy redirects */}
          <Route path="monitoring" element={<Navigate to="/operations" replace />} />
          <Route path="dependencies" element={<DependencyMapPage />} />
          <Route path="incidents" element={<IncidentExplorer />} />
          <Route path="rca" element={<RCADashboard />} />
          <Route path="blast-radius" element={<BlastRadiusDashboard />} />
          <Route path="early-detection" element={<EarlyDetectionDashboard />} />
          <Route path="investigation" element={<InvestigationWorkflow />} />
          <Route path="admin" element={<DataAdminPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
