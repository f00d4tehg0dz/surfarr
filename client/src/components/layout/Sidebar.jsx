import { NavLink } from 'react-router-dom';
import Icon from '../shared/Icon';
import Clock from '../shared/Clock';
import logo from '../../logo.png';

export const NAV = [
  { to: '/',         label: 'On Now',   icon: 'grid', exact: true },
  { to: '/epg',      label: 'TV Guide', icon: 'guide' },
  { to: '/tv',       label: 'TV Mode',  icon: 'tv' },
  { to: '/plugins',  label: 'Plugins',  icon: 'plug' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
  { to: '/report',   label: 'Report',   icon: 'flag' },
];

function navClass({ isActive }) {
  return `group relative flex items-center gap-3 px-3 py-2.5 text-sm font-semibold rounded-xl transition-colors ${
    isActive
      ? 'bg-m3-primary/10 text-m3-text'
      : 'text-m3-textSecondary hover:text-m3-text hover:bg-m3-surfaceContainer'
  }`;
}

export default function Sidebar() {
  return (
    <>
      {/* Desktop rail */}
      <aside className="hidden md:flex w-60 shrink-0 flex-col border-r border-m3-border bg-m3-surface/60 backdrop-blur-xl">
        <div className="px-5 pt-6 pb-5">
          <div className="flex items-center gap-3">
            <img src={logo} alt="" className="w-9 h-9 rounded-xl ring-1 ring-m3-border" />
            <div>
              <div className="font-display text-xl font-extrabold tracking-tight leading-none">
                Surf<span className="text-m3-primary">Arr</span>
              </div>
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-m3-muted mt-1">Linear TV</div>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-3 space-y-1">
          {NAV.map(({ to, label, icon, exact }) => (
            <NavLink key={to} to={to} end={exact} className={navClass}>
              {({ isActive }) => (
                <>
                  <span className={`absolute left-0 top-2 bottom-2 w-1 rounded-r-full bg-m3-primary transition-opacity ${isActive ? 'opacity-100' : 'opacity-0'}`} />
                  <Icon name={icon} className={isActive ? 'text-m3-primary' : 'text-m3-muted group-hover:text-m3-textSecondary'} />
                  {label}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* cable box */}
        <div className="m-3 rounded-2xl border border-m3-border bg-black/40 px-4 py-3">
          <div className="flex items-center justify-between">
            <Clock className="text-2xl" />
            <span className="w-2 h-2 rounded-full bg-m3-success shadow-[0_0_8px_rgba(126,226,168,.8)]" title="Tuner on" />
          </div>
          <div className="smpte mt-3 rounded-full" />
        </div>
      </aside>

      {/* Mobile tab bar */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 border-t border-m3-border bg-m3-surface/90 backdrop-blur-xl pb-[env(safe-area-inset-bottom)]">
        <div className="grid grid-cols-5">
          {NAV.slice(0, 5).map(({ to, label, icon, exact }) => (
            <NavLink
              key={to} to={to} end={exact}
              className={({ isActive }) => `flex flex-col items-center gap-1 py-2.5 text-[10px] font-semibold ${isActive ? 'text-m3-primary' : 'text-m3-muted'}`}
            >
              <Icon name={icon} size={20} />
              {label}
            </NavLink>
          ))}
        </div>
      </nav>
    </>
  );
}
