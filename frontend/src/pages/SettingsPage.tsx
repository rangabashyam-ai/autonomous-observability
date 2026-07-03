import { useState } from 'react';
import { PageHeader } from '../components/ui';
import { Settings, Bell, Shield, Database, Palette, Users, Globe, Save } from 'lucide-react';

type SettingsSection = 'general' | 'notifications' | 'security' | 'data' | 'appearance' | 'team' | 'integrations';

const sections: { id: SettingsSection; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'general', label: 'General', icon: Settings },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'security', label: 'Security', icon: Shield },
  { id: 'data', label: 'Data & Storage', icon: Database },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'team', label: 'Team', icon: Users },
  { id: 'integrations', label: 'Integrations', icon: Globe },
];

function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 focus:outline-none ${
        checked ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-600'
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm transition-transform duration-200 ${
          checked ? 'translate-x-4' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

function SettingRow({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-4 border-b border-slate-100 dark:border-slate-700/60 last:border-0">
      <div className="min-w-0 mr-8">
        <p className="text-sm font-medium text-slate-900 dark:text-white">{label}</p>
        {description && <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export default function SettingsPage() {
  const [activeSection, setActiveSection] = useState<SettingsSection>('general');
  const [saved, setSaved] = useState(false);

  // General
  const [orgName, setOrgName] = useState('Bank Operations');
  const [timezone, setTimezone] = useState('Asia/Kolkata');
  const [language, setLanguage] = useState('English');

  // Notifications
  const [emailAlerts, setEmailAlerts] = useState(true);
  const [slackAlerts, setSlackAlerts] = useState(false);
  const [p1Notify, setP1Notify] = useState(true);
  const [p2Notify, setP2Notify] = useState(true);
  const [weeklyDigest, setWeeklyDigest] = useState(false);

  // Security
  const [mfa, setMfa] = useState(false);
  const [sessionTimeout, setSessionTimeout] = useState('60');
  const [auditLog, setAuditLog] = useState(true);

  // Data
  const [retentionDays, setRetentionDays] = useState('90');
  const [autoBackup, setAutoBackup] = useState(true);
  const [compressionEnabled, setCompressionEnabled] = useState(true);

  // Appearance
  const [compactMode, setCompactMode] = useState(false);
  const [animations, setAnimations] = useState(true);

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  return (
    <div>
      <PageHeader
        title="Settings"
        description="Configure platform preferences, notifications, security, and team settings"
      />

      <div className="flex gap-6">
        {/* Sidebar */}
        <aside className="w-48 shrink-0">
          <nav className="space-y-0.5 bg-white dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700/60 rounded-2xl p-2">
            {sections.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setActiveSection(id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-all text-left ${
                  activeSection === id
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700/50'
                }`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                {label}
              </button>
            ))}
          </nav>
        </aside>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="bg-white dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700/60 rounded-2xl p-6">

            {/* General */}
            {activeSection === 'general' && (
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-4">General Settings</h3>
                <div className="space-y-0">
                  <SettingRow label="Organization Name" description="Displayed across all dashboards and reports.">
                    <input
                      value={orgName}
                      onChange={e => setOrgName(e.target.value)}
                      className="text-sm px-3 py-1.5 w-48 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:border-blue-500"
                    />
                  </SettingRow>
                  <SettingRow label="Timezone" description="Used for all time-based displays and alerts.">
                    <select
                      value={timezone}
                      onChange={e => setTimezone(e.target.value)}
                      className="text-sm px-3 py-1.5 w-48 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none"
                    >
                      <option>Asia/Kolkata</option>
                      <option>UTC</option>
                      <option>America/New_York</option>
                      <option>Europe/London</option>
                      <option>Asia/Tokyo</option>
                    </select>
                  </SettingRow>
                  <SettingRow label="Language" description="Interface language for all users.">
                    <select
                      value={language}
                      onChange={e => setLanguage(e.target.value)}
                      className="text-sm px-3 py-1.5 w-48 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none"
                    >
                      <option>English</option>
                      <option>Japanese</option>
                      <option>German</option>
                    </select>
                  </SettingRow>
                </div>
              </div>
            )}

            {/* Notifications */}
            {activeSection === 'notifications' && (
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-4">Notification Settings</h3>
                <div className="space-y-0">
                  <SettingRow label="Email Alerts" description="Receive incident and anomaly alerts via email.">
                    <ToggleSwitch checked={emailAlerts} onChange={setEmailAlerts} />
                  </SettingRow>
                  <SettingRow label="Slack Alerts" description="Push critical alerts to a Slack channel webhook.">
                    <ToggleSwitch checked={slackAlerts} onChange={setSlackAlerts} />
                  </SettingRow>
                  <SettingRow label="P1 Incidents" description="Notify immediately on P1 critical incidents.">
                    <ToggleSwitch checked={p1Notify} onChange={setP1Notify} />
                  </SettingRow>
                  <SettingRow label="P2 Incidents" description="Notify on high-severity P2 incidents.">
                    <ToggleSwitch checked={p2Notify} onChange={setP2Notify} />
                  </SettingRow>
                  <SettingRow label="Weekly Digest" description="Send a weekly summary report every Monday at 9 AM.">
                    <ToggleSwitch checked={weeklyDigest} onChange={setWeeklyDigest} />
                  </SettingRow>
                </div>
              </div>
            )}

            {/* Security */}
            {activeSection === 'security' && (
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-4">Security Settings</h3>
                <div className="space-y-0">
                  <SettingRow label="Multi-Factor Authentication" description="Require MFA for all admin accounts.">
                    <ToggleSwitch checked={mfa} onChange={setMfa} />
                  </SettingRow>
                  <SettingRow label="Session Timeout (minutes)" description="Auto-logout after inactivity.">
                    <input
                      type="number"
                      value={sessionTimeout}
                      onChange={e => setSessionTimeout(e.target.value)}
                      min="5"
                      max="480"
                      className="text-sm px-3 py-1.5 w-24 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:border-blue-500 text-center"
                    />
                  </SettingRow>
                  <SettingRow label="Audit Log" description="Record all admin and config change events.">
                    <ToggleSwitch checked={auditLog} onChange={setAuditLog} />
                  </SettingRow>
                </div>
              </div>
            )}

            {/* Data & Storage */}
            {activeSection === 'data' && (
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-4">Data & Storage</h3>
                <div className="space-y-0">
                  <SettingRow label="Data Retention (days)" description="How long raw telemetry and incident data is retained.">
                    <input
                      type="number"
                      value={retentionDays}
                      onChange={e => setRetentionDays(e.target.value)}
                      min="7"
                      max="730"
                      className="text-sm px-3 py-1.5 w-24 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:border-blue-500 text-center"
                    />
                  </SettingRow>
                  <SettingRow label="Automatic Backups" description="Backup dataset and config files daily.">
                    <ToggleSwitch checked={autoBackup} onChange={setAutoBackup} />
                  </SettingRow>
                  <SettingRow label="Compression" description="Enable gzip compression on stored parquet and JSON files.">
                    <ToggleSwitch checked={compressionEnabled} onChange={setCompressionEnabled} />
                  </SettingRow>
                </div>
              </div>
            )}

            {/* Appearance */}
            {activeSection === 'appearance' && (
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-4">Appearance</h3>
                <div className="space-y-0">
                  <SettingRow label="Compact Mode" description="Reduce padding and spacing for denser data views.">
                    <ToggleSwitch checked={compactMode} onChange={setCompactMode} />
                  </SettingRow>
                  <SettingRow label="Animations" description="Enable micro-animations and page transitions.">
                    <ToggleSwitch checked={animations} onChange={setAnimations} />
                  </SettingRow>
                </div>
                <div className="mt-4 p-4 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700/60">
                  <p className="text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2">Theme</p>
                  <p className="text-xs text-slate-500">Use the moon/sun icon at the bottom of the sidebar to toggle between Light and Dark mode.</p>
                </div>
              </div>
            )}

            {/* Team */}
            {activeSection === 'team' && (
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-4">Team & Roles</h3>
                <div className="space-y-3">
                  {[
                    { name: 'Ops Admin', email: 'ops-admin@bank.internal', role: 'Admin' },
                    { name: 'SRE Lead', email: 'sre-lead@bank.internal', role: 'Editor' },
                    { name: 'Platform Team', email: 'platform@bank.internal', role: 'Viewer' },
                  ].map(member => (
                    <div key={member.email} className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700/50">
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-full bg-blue-500/10 flex items-center justify-center text-xs font-bold text-blue-500">
                          {member.name.split(' ').map(n => n[0]).join('')}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-slate-900 dark:text-white">{member.name}</p>
                          <p className="text-xs text-slate-500">{member.email}</p>
                        </div>
                      </div>
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-md ${
                        member.role === 'Admin' ? 'bg-blue-500/10 text-blue-500' :
                        member.role === 'Editor' ? 'bg-amber-500/10 text-amber-500' :
                        'bg-slate-200 dark:bg-slate-700 text-slate-500'
                      }`}>{member.role}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Integrations */}
            {activeSection === 'integrations' && (
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-4">External Integrations</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">Configure third-party service connections. Cloud provider integrations can be managed under the Integrations page.</p>
                <div className="space-y-3">
                  {[
                    { name: 'PagerDuty', status: 'Disconnected', color: 'text-red-400' },
                    { name: 'Slack', status: 'Disconnected', color: 'text-red-400' },
                    { name: 'Jira', status: 'Disconnected', color: 'text-red-400' },
                    { name: 'ServiceNow', status: 'Disconnected', color: 'text-red-400' },
                  ].map(item => (
                    <div key={item.name} className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700/50">
                      <p className="text-sm font-medium text-slate-900 dark:text-white">{item.name}</p>
                      <div className="flex items-center gap-3">
                        <span className={`text-xs font-medium ${item.color}`}>{item.status}</span>
                        <button className="text-xs px-3 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold transition-colors">
                          Connect
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Save button */}
            {activeSection !== 'team' && activeSection !== 'integrations' && (
              <div className="flex justify-end mt-6 pt-4 border-t border-slate-100 dark:border-slate-700/60">
                <button
                  onClick={handleSave}
                  className={`flex items-center gap-2 px-5 py-2 text-sm font-semibold rounded-xl transition-all shadow-sm ${
                    saved
                      ? 'bg-emerald-600 text-white'
                      : 'bg-blue-600 hover:bg-blue-500 active:scale-[0.98] text-white'
                  }`}
                >
                  <Save className="h-3.5 w-3.5" />
                  {saved ? 'Saved!' : 'Save Changes'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
