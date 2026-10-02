import { useState } from 'react';
import {
  usePluginRepo,
  useInstalledPlugins,
  useInstallPlugin,
  useUninstallPlugin,
} from '../hooks/usePlugins';
import LoadingSpinner from '../components/shared/LoadingSpinner';

export default function PluginStore() {
  const { data: repo, isLoading: repoLoading } = usePluginRepo();
  const { data: installed, isLoading: installedLoading } = useInstalledPlugins();
  const { mutate: install, isPending: isInstalling, variables: installingId } = useInstallPlugin();
  const { mutate: uninstall, isPending: isUninstalling, variables: uninstallingId } = useUninstallPlugin();
  const [search, setSearch] = useState('');
  const [selectedTag, setSelectedTag] = useState(null);

  const isLoading = repoLoading || installedLoading;

  // Collect all unique tags
  const allTags = [];
  if (repo?.plugins) {
    const tagSet = new Set();
    for (const p of repo.plugins) {
      for (const t of p.tags || []) tagSet.add(t);
    }
    allTags.push(...[...tagSet].sort());
  }

  // Filter plugins
  const filtered = (repo?.plugins || []).filter((p) => {
    if (search) {
      const q = search.toLowerCase();
      const matches =
        p.name.toLowerCase().includes(q) ||
        p.description?.toLowerCase().includes(q) ||
        p.author?.toLowerCase().includes(q) ||
        (p.tags || []).some((t) => t.includes(q));
      if (!matches) return false;
    }
    if (selectedTag && !(p.tags || []).includes(selectedTag)) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow">Add-ons</div>
          <h1 className="page-title mt-1">
            Plugin Store
          </h1>
          <p className="text-m3-muted text-sm mt-1">
            Browse and install community channels.
            <a
              href="https://github.com/f00d4tehg0dz/surfarr/tree/main/plugin-repo"
              target="_blank"
              rel="noopener noreferrer"
              className="text-m3-primary hover:underline ml-1"
            >
              Submit your own via Pull Request
            </a>
          </p>
        </div>
        {repo && (
          <div className="text-sm text-m3-muted">
            <span className="text-m3-primary font-medium">{repo.totalInstalled}</span>
            {' / '}{repo.totalAvailable} installed
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-40">
          <LoadingSpinner size="lg" text="Loading plugins..." />
        </div>
      ) : (
        <>
          {/* Search + Tag filters */}
          <div className="space-y-3">
            <input
              className="input max-w-md"
              type="text"
              placeholder="Search plugins..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {allTags.length > 0 && (
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() => setSelectedTag(null)}
                  className={`px-3 py-1 text-xs font-medium border rounded-full transition-all ${
                    !selectedTag
                      ? 'bg-m3-primary text-m3-onPrimary border-m3-primary'
                      : 'bg-transparent text-m3-textSecondary border-m3-border hover:border-m3-primary/50 hover:text-m3-primary'
                  }`}
                >
                  All
                </button>
                {allTags.map((tag) => (
                  <button
                    key={tag}
                    onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}
                    className={`px-3 py-1 text-xs font-medium border rounded-full transition-all ${
                      selectedTag === tag
                        ? 'bg-m3-primary text-m3-onPrimary border-m3-primary'
                        : 'bg-transparent text-m3-textSecondary border-m3-border hover:border-m3-primary/50 hover:text-m3-primary'
                    }`}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Plugin cards */}
          {filtered.length === 0 ? (
            <div className="panel p-8 text-center">
              <div className="text-m3-muted text-sm">No plugins match your search.</div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filtered.map((plugin) => {
                const busy =
                  (isInstalling && installingId === plugin.id) ||
                  (isUninstalling && uninstallingId === plugin.id);

                return (
                  <div
                    key={plugin.id}
                    className={`card flex flex-col !p-5 hover:-translate-y-0.5 ${plugin.installed ? '!border-m3-primary/40' : ''}`}
                  >
                    {/* Header */}
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <div className="flex items-center gap-2">
                        <span className="grid h-11 w-11 place-items-center rounded-xl border border-m3-border bg-black/30 text-2xl leading-none">{plugin.icon || '📺'}</span>
                        <div>
                          <div className="font-display text-base font-bold text-m3-text">{plugin.name}</div>
                          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-m3-muted">
                            <span className="ch-num !h-5 !min-w-0 text-[10px]">{plugin.channelNumber}</span>
                            {plugin.author && <> · by {plugin.author}</>}
                          </div>
                        </div>
                      </div>
                      {plugin.installed && (
                        <span className="text-xs font-medium text-m3-success border border-m3-success/30 px-2 py-0.5 rounded-full shrink-0">
                          Installed
                        </span>
                      )}
                    </div>

                    {/* Description */}
                    <p className="text-sm text-m3-textSecondary flex-1 mb-3">
                      {plugin.description || 'No description provided.'}
                    </p>

                    {/* Tags */}
                    {plugin.tags?.length > 0 && (
                      <div className="flex gap-1 flex-wrap mb-4">
                        {plugin.tags.map((tag) => (
                          <span
                            key={tag}
                            className="rounded-full border border-m3-border px-2 py-0.5 text-[11px] text-m3-muted"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Actions */}
                    <div className="mt-auto">
                      {plugin.installed ? (
                        <button
                          onClick={() => uninstall(plugin.id)}
                          disabled={busy}
                          className="btn-danger w-full text-xs"
                        >
                          {busy ? 'Removing...' : 'Uninstall'}
                        </button>
                      ) : (
                        <button
                          onClick={() => install(plugin.id)}
                          disabled={busy}
                          className="btn-primary w-full text-xs"
                        >
                          {busy ? 'Installing...' : 'Install'}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Installed plugins detail */}
          {installed?.length > 0 && (
            <div className="mt-8 space-y-3">
              <div className="border-b border-m3-border pb-2">
                <h2 className="text-2xl font-bold tracking-tight text-m3-text">
                  Installed Plugins
                </h2>
                <p className="text-m3-muted text-sm mt-1">
                  Locally installed in the <code className="text-m3-accent">plugins/</code> directory
                </p>
              </div>
              <div className="space-y-2">
                {installed.map((p) => (
                  <div
                    key={p.configFile}
                    className="flex items-center justify-between border border-m3-border rounded-m3-sm p-3 bg-m3-surface"
                  >
                    <div>
                      <div className="text-sm font-medium text-m3-text">{p.name}</div>
                      <div className="text-xs text-m3-muted">
                        CH {p.channelNumber} · {p.videoCount} videos
                        {p.lastSync && <> · Synced {new Date(p.lastSync).toLocaleDateString()}</>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${p.enabled ? 'bg-m3-success' : 'bg-m3-muted'}`} />
                      <span className="text-xs text-m3-muted">{p.enabled ? 'Enabled' : 'Disabled'}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
