import DependencyMap from '../components/DependencyMap';
import { ErrorBoundary } from '../components/ErrorBoundary';

export default function DependencyMapPage() {
  return (
    <ErrorBoundary>
      <DependencyMap />
    </ErrorBoundary>
  );
}
