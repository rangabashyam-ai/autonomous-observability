import { useSearchParams } from 'react-router-dom';

export function useDrawerState() {
  const [searchParams, setSearchParams] = useSearchParams();

  const drawerType = searchParams.get('drawer');
  const drawerId = searchParams.get('drawerId');
  const metricType = searchParams.get('metricType');
  const subDrawerType = searchParams.get('subDrawer');
  const subDrawerId = searchParams.get('subDrawerId');

  const openDrawer = (
    type: string,
    id?: string,
    opts?: { metricType?: string; keepOtherParams?: boolean }
  ) => {
    const newParams = opts?.keepOtherParams ? new URLSearchParams(searchParams) : new URLSearchParams();
    newParams.set('drawer', type);
    if (id) {
      newParams.set('drawerId', id);
    } else {
      newParams.delete('drawerId');
    }
    if (opts?.metricType) {
      newParams.set('metricType', opts.metricType);
    } else {
      newParams.delete('metricType');
    }
    // Clean up subDrawer params when opening a new primary drawer
    newParams.delete('subDrawer');
    newParams.delete('subDrawerId');
    setSearchParams(newParams);
  };

  const openSubDrawer = (type: string, id: string) => {
    const newParams = new URLSearchParams(searchParams);
    newParams.set('subDrawer', type);
    newParams.set('subDrawerId', id);
    setSearchParams(newParams);
  };

  const closeDrawer = () => {
    const newParams = new URLSearchParams(searchParams);
    newParams.delete('drawer');
    newParams.delete('drawerId');
    newParams.delete('metricType');
    newParams.delete('subDrawer');
    newParams.delete('subDrawerId');
    setSearchParams(newParams);
  };

  const closeSubDrawer = () => {
    const newParams = new URLSearchParams(searchParams);
    newParams.delete('subDrawer');
    newParams.delete('subDrawerId');
    setSearchParams(newParams);
  };

  return {
    drawerType,
    drawerId,
    metricType,
    subDrawerType,
    subDrawerId,
    openDrawer,
    openSubDrawer,
    closeDrawer,
    closeSubDrawer,
  };
}
