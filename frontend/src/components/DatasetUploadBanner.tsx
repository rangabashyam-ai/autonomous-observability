import { Link } from 'react-router-dom';
import { AlertTriangle, Plug } from 'lucide-react';
import { NO_DATA_MESSAGE } from '../utils/emptyState';

interface DatasetUploadBannerProps {
  onUploadSuccess?: () => void;
}

export default function DatasetUploadBanner(_props: DatasetUploadBannerProps) {
  return (
    <div className="mb-6 p-5 rounded-2xl border border-amber-500/20 bg-amber-550/10 text-slate-700 dark:text-slate-300 flex flex-col md:flex-row md:items-center justify-between gap-4 transition-all duration-300 shadow-sm animate-fade-in">
      <div className="flex gap-3.5 items-start">
        <div className="p-2 rounded-xl bg-amber-500/10 text-amber-500 flex-shrink-0 mt-0.5">
          <AlertTriangle className="h-5 w-5 animate-pulse" />
        </div>
        <div>
          <h4 className="font-semibold text-sm text-slate-900 dark:text-amber-300">
            No data source connected
          </h4>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-2xl leading-relaxed">
            {NO_DATA_MESSAGE}. Connect cloud integrations or configure your observability pipeline to populate live metrics, incidents, and dependency data.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3 flex-shrink-0 self-end md:self-center">
        <Link
          to="/integrations"
          className="flex items-center gap-2 px-4 py-2 text-xs font-semibold text-amber-800 dark:text-slate-900 bg-amber-400 hover:bg-amber-300 hover:scale-[1.02] active:scale-[0.98] border border-amber-500/20 rounded-xl cursor-pointer transition-all shadow-sm"
        >
          <Plug className="h-4 w-4" />
          <span>Connect Data Source</span>
        </Link>
      </div>
    </div>
  );
}
