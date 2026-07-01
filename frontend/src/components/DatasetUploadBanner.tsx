import { useState } from 'react';
import { uploadDatasetJson } from '../api/client';
import { UploadCloud, AlertTriangle, CheckCircle, XCircle, Loader2 } from 'lucide-react';

interface DatasetUploadBannerProps {
  onUploadSuccess?: () => void;
}

export default function DatasetUploadBanner({ onUploadSuccess }: DatasetUploadBannerProps) {
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.json')) {
      setStatus('error');
      setMessage('Please upload a valid .json dataset file.');
      return;
    }

    setUploading(true);
    setStatus('idle');
    setMessage('');

    try {
      await uploadDatasetJson(file);
      setStatus('success');
      setMessage('Dataset uploaded and activated successfully!');
      if (onUploadSuccess) {
        setTimeout(() => {
          onUploadSuccess();
        }, 1500);
      }
    } catch (err) {
      setStatus('error');
      setMessage(err instanceof Error ? err.message : 'Failed to upload and extract dataset.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="mb-6 p-5 rounded-2xl border border-amber-500/20 bg-amber-550/10 text-slate-700 dark:text-slate-300 flex flex-col md:flex-row md:items-center justify-between gap-4 transition-all duration-300 shadow-sm animate-fade-in">
      <div className="flex gap-3.5 items-start">
        <div className="p-2 rounded-xl bg-amber-500/10 text-amber-500 flex-shrink-0 mt-0.5">
          {status === 'success' ? (
            <CheckCircle className="h-5 w-5 text-emerald-500 animate-bounce" />
          ) : status === 'error' ? (
            <XCircle className="h-5 w-5 text-red-500" />
          ) : (
            <AlertTriangle className="h-5 w-5 animate-pulse" />
          )}
        </div>
        <div>
          <h4 className="font-semibold text-sm text-slate-900 dark:text-amber-300">
            {status === 'success' ? 'Dataset Activated' : 'Observability dataset not detected'}
          </h4>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-2xl leading-relaxed">
            {status === 'success'
              ? 'Reloading the dashboard with the active dataset...'
              : status === 'error'
              ? message
              : 'Please Connect your Data Source, generate synthetic data in the Admin panel, or upload an incident dataset JSON directly to run live analysis.'}
          </p>
          {message && status !== 'success' && status !== 'error' && (
            <p className="text-xs text-amber-500 font-medium mt-1">{message}</p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 flex-shrink-0 self-end md:self-center">
        {uploading ? (
          <div className="flex items-center gap-2 px-4 py-2 text-xs font-semibold text-amber-600 bg-amber-500/10 border border-amber-500/25 rounded-xl animate-pulse">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Processing JSON...</span>
          </div>
        ) : status === 'success' ? (
          <div className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-emerald-600 dark:text-green-400 bg-emerald-500/10 border border-emerald-500/25 rounded-xl">
            <CheckCircle className="h-4 w-4" />
            <span>Success</span>
          </div>
        ) : (
          <label className="flex items-center gap-2 px-4 py-2 text-xs font-semibold text-amber-800 dark:text-slate-900 bg-amber-400 hover:bg-amber-300 hover:scale-[1.02] active:scale-[0.98] border border-amber-500/20 rounded-xl cursor-pointer transition-all shadow-sm">
            <UploadCloud className="h-4 w-4" />
            <span>Upload Dataset (.json)</span>
            <input
              type="file"
              accept=".json"
              className="hidden"
              onChange={handleFileChange}
              disabled={uploading}
            />
          </label>
        )}
      </div>
    </div>
  );
}
