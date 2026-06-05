import { useEffect, useState } from 'react';
import { getDataStatus, regenerateData, uploadDataFile } from '../api/client';
import { PageHeader, StatCard } from '../components/ui';

export default function DataAdminPage() {
  const [files, setFiles] = useState<{ file: string; exists: boolean; size_bytes: number; records: number }[]>([]);
  const [regenerating, setRegenerating] = useState(false);
  const [message, setMessage] = useState('');

  const load = () => getDataStatus().then((r) => setFiles(r.files));

  useEffect(() => { load(); }, []);

  const handleRegenerate = async () => {
    setRegenerating(true);
    setMessage('');
    try {
      await regenerateData();
      setMessage('Data regenerated successfully');
      load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Regeneration failed');
    } finally {
      setRegenerating(false);
    }
  };

  const handleUpload = async (category: string, file: File) => {
    try {
      await uploadDataFile(category, file);
      setMessage(`Uploaded to ${category}`);
      load();
    } catch {
      setMessage('Upload failed');
    }
  };

  const totalRecords = files.reduce((s, f) => s + f.records, 0);

  return (
    <div>
      <PageHeader
        title="Synthetic Data Admin"
        description="Manage JSON datasets, regenerate synthetic data, and upload custom files"
      />

      <div className="grid grid-cols-3 gap-4 mb-6">
        <StatCard label="Data Files" value={files.filter((f) => f.exists).length} />
        <StatCard label="Total Records" value={totalRecords} />
        <StatCard label="Incidents" value={files.find((f) => f.file.includes('service_now'))?.records ?? 0} />
      </div>

      {message && (
        <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-500/30 rounded-lg text-sm text-blue-300">{message}</div>
      )}

      <div className="flex gap-3 mb-6">
        <button
          onClick={handleRegenerate}
          disabled={regenerating}
          className="px-4 py-2 text-sm bg-green-600 rounded-lg hover:bg-green-500 disabled:opacity-50"
        >
          {regenerating ? 'Regenerating...' : 'Regenerate All Synthetic Data'}
        </button>
      </div>

      <div className="overflow-x-auto mb-8">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
              <th className="pb-2">File</th>
              <th className="pb-2">Status</th>
              <th className="pb-2">Size</th>
              <th className="pb-2">Records</th>
            </tr>
          </thead>
          <tbody>
            {files.map((f) => (
              <tr key={f.file} className="border-b border-slate-100 dark:border-slate-800">
                <td className="py-2 font-mono text-xs text-slate-700 dark:text-slate-300">{f.file}</td>
                <td className="py-2">
                  <span className={`text-xs ${f.exists ? 'text-emerald-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                    {f.exists ? 'OK' : 'Missing'}
                  </span>
                </td>
                <td className="py-2 text-xs text-slate-500">{(f.size_bytes / 1024).toFixed(1)} KB</td>
                <td className="py-2 text-xs text-slate-500 dark:text-slate-400">{f.records}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">Upload Custom JSON</h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {['incidents', 'alerts', 'dependencies', 'knowledge-graph'].map((cat) => (
          <label key={cat} className="p-4 bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl cursor-pointer hover:border-blue-500 text-center">
            <p className="text-sm text-slate-900 dark:text-white capitalize">{cat.replace('-', ' ')}</p>
            <p className="text-xs text-slate-500 mt-1">Click to upload JSON</p>
            <input
              type="file"
              accept=".json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleUpload(cat, file);
              }}
            />
          </label>
        ))}
      </div>
    </div>
  );
}
