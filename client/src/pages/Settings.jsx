import { useState, useEffect } from 'react';
import { useSettings, useUpdateSettings, useForceSync } from '../hooks/useSettings';
import LoadingSpinner from '../components/shared/LoadingSpinner';
import { useStatus } from '../hooks/useSettings';
import { getAdminKey, setAdminKey } from '../api/retroApi';

function AccessPanel() {
  const { data: status } = useStatus();
  const [key, setKey] = useState(getAdminKey());
  const [saved, setSaved] = useState(false);
  const tokenMode = status?.adminMode === 'token';
  return (
    <div className="panel p-5 sm:p-6 space-y-3">
      <h2 className="eyebrow">Access</h2>
      <p className="text-sm text-m3-muted">
        {tokenMode
          ? 'This server requires an admin key for changes (ADMIN_TOKEN). Enter it once per browser.'
          : 'Changes are allowed from your local network. Set ADMIN_TOKEN on the server to manage SurfArr from anywhere with a key.'}
      </p>
      <div className="flex gap-2">
        <input className="input" type="password" autoComplete="off" placeholder="Admin key" value={key}
          onChange={(e) => { setKey(e.target.value); setSaved(false); }} />
        <button type="button" className="btn-secondary shrink-0" onClick={() => { setAdminKey(key.trim()); setSaved(true); }}>
          {saved ? 'Saved' : 'Save'}
        </button>
      </div>
    </div>
  );
}

export default function Settings() {
  const { data: settings, isLoading } = useSettings();
  const { mutate: updateSettings, isPending: isSaving } = useUpdateSettings();
  const { mutate: forceSync, isPending: isSyncing, data: syncResult } = useForceSync();

  const [form, setForm] = useState({
    remoteApiUrl: '',
    deviceName: 'SurfArr',
    streamQuality: '720p',
    tunerCount: 4,
  });

  useEffect(() => {
    if (settings) {
      setForm({
        remoteApiUrl: settings.remoteApiUrl || '',
        deviceName: settings.deviceName || 'SurfArr',
        streamQuality: settings.streamQuality || '720p',
        tunerCount: settings.tunerCount || 4,
      });
    }
  }, [settings]);

  function handleSave(e) {
    e.preventDefault();
    updateSettings(form);
  }

  if (isLoading) return (
    <div className="flex items-center justify-center h-40">
      <LoadingSpinner text="Loading settings..." />
    </div>
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <div className="eyebrow">Control room</div>
        <h1 className="page-title mt-1">Settings</h1>
        <p className="mt-2 text-sm text-m3-muted">Where the lineup comes from, how it streams, and how your TV apps see this tuner.</p>
      </header>

      <AccessPanel />

      {/* Status panel */}
      <div className="panel p-5 sm:p-6 space-y-3">
        <h2 className="eyebrow">
          System Status
        </h2>
        <div className="flex justify-between items-center">
          <span className="font-medium text-m3-muted text-sm">Last Sync</span>
          <span className="text-m3-text text-sm">
            {settings?.lastSync ? new Date(settings.lastSync).toLocaleString() : 'Never'}
          </span>
        </div>
        <div className="flex justify-between items-center">
          <span className="font-medium text-m3-muted text-sm">Channels</span>
          <span className="text-m3-text text-sm">
            <span className="text-m3-primary font-medium">{settings?.enabledChannelCount}</span>
            {' / '}{settings?.channelCount} enabled
          </span>
        </div>
      </div>

      {/* Config form */}
      <form onSubmit={handleSave} className="panel p-5 sm:p-6 space-y-4">
        <h2 className="eyebrow">
          Configuration
        </h2>

        <div>
          <label className="label">Remote API URL</label>
          <input
            className="input"
            type="url"
            placeholder="https://retroarr-api.f00d.me"
            value={form.remoteApiUrl}
            onChange={(e) => setForm((f) => ({ ...f, remoteApiUrl: e.target.value }))}
          />
          <p className="text-xs text-m3-muted mt-1.5">
            Endpoint for video metadata.
          </p>
        </div>

        <div>
          <label className="label">Device Name</label>
          <input
            className="input"
            type="text"
            value={form.deviceName}
            onChange={(e) => setForm((f) => ({ ...f, deviceName: e.target.value }))}
          />
        </div>

        <div>
          <label className="label">Stream Quality</label>
          <select
            className="input"
            value={form.streamQuality}
            onChange={(e) => setForm((f) => ({ ...f, streamQuality: e.target.value }))}
          >
            <option value="720p">720p (HD)</option>
            <option value="1080p">1080p (Full HD)</option>
          </select>
        </div>

        <div>
          <label className="label">Tuner Count (max simultaneous streams)</label>
          <select
            className="input"
            value={form.tunerCount}
            onChange={(e) => setForm((f) => ({ ...f, tunerCount: parseInt(e.target.value) }))}
          >
            {[1, 2, 3, 4, 6, 8].map((n) => (
              <option key={n} value={n}>{n} tuner{n > 1 ? 's' : ''}</option>
            ))}
          </select>
        </div>

        <button type="submit" className="btn-primary w-full" disabled={isSaving}>
          {isSaving ? 'Saving...' : 'Save Settings'}
        </button>
      </form>

      {/* Sync panel */}
      <div className="panel p-5 sm:p-6 space-y-3">
        <h2 className="eyebrow">
          Data Sync
        </h2>
        <p className="text-sm text-m3-muted">
          Pull the latest video data from your remote API. Runs automatically at 3 AM daily.
        </p>

        <button
          onClick={() => forceSync()}
          disabled={isSyncing}
          className="btn-secondary w-full"
        >
          {isSyncing ? <LoadingSpinner size="sm" text="Syncing..." /> : 'Sync Now'}
        </button>

        {syncResult && (
          <div className="border border-m3-success/30 bg-m3-successContainer/10 p-3 rounded-m3-sm text-sm">
            <span className="text-m3-success font-medium">Sync Complete — </span>
            <span className="text-m3-text">{syncResult.syncedCount} channels updated</span>
            {syncResult.errorCount > 0 && (
              <span className="text-m3-error ml-2">({syncResult.errorCount} errors)</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
