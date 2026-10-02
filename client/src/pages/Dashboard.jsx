import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useChannels, useNowPlaying } from '../hooks/useChannels';
import ChannelGrid from '../components/channels/ChannelGrid';
import LoadingSpinner from '../components/shared/LoadingSpinner';
import useChannelStore from '../store/useChannelStore';
import usePlayerStore from '../store/usePlayerStore';
import Icon from '../components/shared/Icon';
import { thumb, fmtMins, progress } from '../components/shared/thumb';

const DECADES = ['60s', '70s', '80s', '90s', '00s', '10s', '20s'];

function CopyField({ label, value }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => { navigator.clipboard?.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1400); }}
      className="group flex w-full items-center gap-3 rounded-xl border border-m3-border bg-black/30 px-3 py-2 text-left transition-colors hover:border-m3-primary/50"
    >
      <span className="w-12 shrink-0 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-m3-muted">{label}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-xs text-m3-accent">{value}</span>
      <span className="shrink-0 text-[11px] font-semibold text-m3-muted group-hover:text-m3-primary">{copied ? 'Copied' : <Icon name="copy" size={14} />}</span>
    </button>
  );
}

function Featured({ channel, np }) {
  const open = usePlayerStore((s) => s.open);
  if (!channel || !np) return null;
  return (
    <section className="relative overflow-hidden rounded-m3-xl border border-m3-border bg-m3-black shadow-m3-lg screen-glow">
      <img src={thumb(np.videoId, 'maxresdefault')} onError={(e) => { e.currentTarget.src = thumb(np.videoId); }}
        alt="" className="absolute inset-0 h-full w-full object-cover opacity-60" />
      <div className="absolute inset-0 bg-gradient-to-r from-black via-black/75 to-black/10" />
      <div className="absolute inset-0 scanlines" />
      <div className="relative flex min-h-[260px] flex-col justify-end gap-4 p-6 sm:p-8 lg:min-h-[320px] lg:max-w-[60%]">
        <div className="flex items-center gap-2">
          <span className="ch-num text-sm h-7">{channel.channelNumber}</span>
          {channel.isLive ? <span className="on-air">Live</span> : <span className="on-air">On now</span>}
          <span className="text-xs font-medium text-white/70">{channel.name}</span>
        </div>
        <h2 className="font-display text-3xl font-extrabold leading-[1.05] text-white text-balance sm:text-4xl lg:text-5xl">{np.title}</h2>
        {!channel.isLive && np.duration > 0 && (
          <div className="flex max-w-md items-center gap-3">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/20">
              <div className="h-full rounded-full bg-m3-primary" style={{ width: `${progress(np)}%` }} />
            </div>
            <span className="font-mono text-xs text-white/70 tabular-nums">{fmtMins(np.duration - np.seekSeconds)} left</span>
          </div>
        )}
        <div className="flex flex-wrap gap-3 pt-1">
          <button className="btn-primary" onClick={() => open(channel)}><Icon name="play" fill size={16} /> Tune in</button>
          <Link className="btn-secondary" to="/epg"><Icon name="guide" size={16} /> What else is on</Link>
        </div>
      </div>
    </section>
  );
}

function Section({ eyebrow, title, note, items, nowPlayingMap }) {
  return (
    items.length > 0 && (
      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <div className="eyebrow">{eyebrow}</div>
            <h2 className="mt-1 text-2xl font-bold">{title}</h2>
          </div>
          {note && <p className="text-sm text-m3-muted">{note}</p>}
        </div>
        <ChannelGrid channels={items} nowPlayingMap={nowPlayingMap} />
      </section>
    )
  );
}

export default function Dashboard() {
  const { data: channels, isLoading, error } = useChannels();
  const { data: nowPlayingList } = useNowPlaying();
  const { selectedDecade, selectedCategory, setDecadeFilter, setCategoryFilter, clearFilters } = useChannelStore();

  const nowPlayingMap = useMemo(() => Object.fromEntries((nowPlayingList || []).map((e) => [e.id, e])), [nowPlayingList]);

  // A featured channel that changes every 10 minutes (stable while you look at it)
  const featured = useMemo(() => {
    const pool = (nowPlayingList || []).filter((c) => c.nowPlaying?.videoId && !c.isLive);
    if (!pool.length) return null;
    const pick = pool[Math.floor(Date.now() / 600000) % pool.length];
    return { np: pick.nowPlaying, channel: channels?.find((c) => c.id === pick.id) };
  }, [nowPlayingList, channels]);

  if (isLoading) return <div className="grid h-64 place-items-center"><LoadingSpinner size="lg" text="Warming up the tubes…" /></div>;
  if (error) return (
    <div className="panel border-m3-error/40 p-5 text-sm">
      <span className="font-semibold text-m3-error">Can't reach the SurfArr server. </span>
      <span className="text-m3-textSecondary">{error.message}</span>
    </div>
  );

  const all = channels || [];
  const matches = (c) => (!selectedDecade || c.decade === selectedDecade) && (!selectedCategory || c.category === selectedCategory);
  const networks = all.filter((c) => c.isStandalone && !c.isLive && matches(c));
  const grid = all.filter((c) => !c.isStandalone && !c.isPlugin && !c.isLive && matches(c));
  const live = all.filter((c) => c.isLive && !selectedDecade && !selectedCategory);
  const custom = all.filter((c) => c.isPlugin && !c.isLive && matches(c));
  const categories = [...new Set(all.filter((c) => !c.isLive && c.category).map((c) => c.category))].sort();
  const decadesPresent = DECADES.filter((d) => all.some((c) => c.decade === d));
  const enabledCount = all.filter((c) => c.enabled).length;
  const onAir = (nowPlayingList || []).length;
  const origin = window.location.origin;
  const filtered = selectedDecade || selectedCategory;

  return (
    <div className="space-y-10">
      {/* Hero row */}
      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        {featured ? <Featured {...featured} /> : (
          <section className="panel grid min-h-[260px] place-items-center p-8 text-center">
            <div>
              <div className="eyebrow">Stand by</div>
              <h2 className="mt-2 text-3xl font-extrabold">Nothing on the air yet</h2>
              <p className="mt-2 text-sm text-m3-muted">Run a sync from Settings to pull the lineup.</p>
            </div>
          </section>
        )}

        <aside className="panel flex flex-col gap-5 p-5">
          <div>
            <div className="eyebrow">Tonight on SurfArr</div>
            <div className="mt-3 grid grid-cols-3 gap-3">
              {[
                ['On air', onAir],
                ['Channels', enabledCount],
                ['Live 24/7', all.filter((c) => c.isLive).length],
              ].map(([k, v]) => (
                <div key={k} className="rounded-xl border border-m3-border bg-black/30 px-3 py-2.5">
                  <div className="font-display text-2xl font-extrabold tabular-nums">{v}</div>
                  <div className="text-[11px] font-medium text-m3-muted">{k}</div>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="eyebrow">Hook up your TV app</div>
            <p className="mt-1.5 text-xs text-m3-muted">Plex, Jellyfin & Emby find SurfArr as an HDHomeRun tuner. Or paste these into any IPTV player.</p>
            <div className="mt-3 space-y-2">
              <CopyField label="Tuner" value={origin} />
              <CopyField label="M3U" value={`${origin}/playlist.m3u`} />
              <CopyField label="Guide" value={`${origin}/epg.xml`} />
            </div>
          </div>
        </aside>
      </div>

      {/* Filters */}
      <div className="sticky top-0 z-20 -mx-4 space-y-3 border-b border-m3-border bg-m3-bg/85 px-4 py-3 backdrop-blur-xl sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="flex flex-wrap items-center gap-2">
          <span className="label mb-0 mr-1">Era</span>
          <button className={`chip ${!selectedDecade ? 'chip-active' : ''}`} onClick={() => setDecadeFilter(null)}>All</button>
          {decadesPresent.map((d) => (
            <button key={d} className={`chip ${selectedDecade === d ? 'chip-active' : ''}`} onClick={() => setDecadeFilter(selectedDecade === d ? null : d)}>{d}</button>
          ))}
          {filtered && <button className="btn-ghost ml-auto text-xs" onClick={clearFilters}><Icon name="x" size={14} /> Clear</button>}
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
          <span className="label mb-0 mr-1 self-center">Genre</span>
          {categories.map((cat) => (
            <button key={cat} className={`chip shrink-0 ${selectedCategory === cat ? 'chip-active' : ''}`} onClick={() => setCategoryFilter(selectedCategory === cat ? null : cat)}>{cat}</button>
          ))}
        </div>
      </div>

      <Section eyebrow="Live 24/7" title="Always on" note="YouTube live streams — no schedule, just tune in." items={live} nowPlayingMap={nowPlayingMap} />
      <Section eyebrow="Networks" title="Curated channels" note="Hand-built lineups that span the decades." items={networks} nowPlayingMap={nowPlayingMap} />
      <Section eyebrow="By decade" title="The dial" note={`${grid.length} decade × genre channels`} items={grid} nowPlayingMap={nowPlayingMap} />
      <Section eyebrow="Your plugins" title="Custom channels" note="From the plugins/ folder and Plugin Store." items={custom} nowPlayingMap={nowPlayingMap} />

      {filtered && !networks.length && !grid.length && !custom.length && (
        <div className="panel p-10 text-center">
          <div className="font-mono text-xs font-bold tracking-[0.3em] text-m3-muted">— NO SIGNAL —</div>
          <p className="mt-2 text-sm text-m3-textSecondary">Nothing matches that combination. Try another era or genre.</p>
        </div>
      )}
    </div>
  );
}
