'use client';
import { usePathname } from 'next/navigation';
import { useLive } from '@/lib/client/live';
import { minutes } from '@/lib/client/format';

const TITLES: Record<string, string> = { '': 'Overview', traffic: '3D view', forecasts: 'Storms', comms: 'AI chat', logistics: 'Rovers', resupply: 'Earth orders', colonies: 'Colonies', automations: 'Automations', policies: 'Rules', settings: 'Settings' };

export default function Topbar({ onSearch }: { onSearch: () => void }) {
  const path = usePathname();
  const { state } = useLive();
  const seg = path.split('/')[2] ?? '';
  const c = state?.clock;
  return (
    <header className="topbar">
      <div className="crumbs"><span>{state?.me?.site === 'earth' ? 'Earth control' : 'Mars colonies'}</span><span className="sl">/</span><b>{TITLES[seg] ?? 'Overview'}</b></div>
      <div className="right">
        <span className="pill-btn" title={c ? `Mission day (a Mars day is called a "sol") · ${new Date(c.utc).toUTCString().slice(5, 16)}` : ''}>Day <span className="mono" style={{ color: 'var(--ink)' }}>{c ? c.sol.toLocaleString('en-US') : '—'}</span> · {c ? (c.ls >= 160 && c.ls <= 340 ? 'Dust season' : 'Calm season') : '—'}</span>
        <span className="pill-btn" title="How long a message takes to travel between Mars and Earth right now">Messages to Earth: <span className="mono" style={{ color: 'var(--ink)' }}>{c ? minutes(c.lightDelaySec) : '—'}</span></span>
        <button className="search" onClick={onSearch} aria-label="Search and commands" style={{ cursor: 'pointer', textAlign: 'left' }}>
          <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" fill="none" stroke="#8A919C" strokeWidth="2" /><path d="M16 16l4 4" stroke="#8A919C" strokeWidth="2" strokeLinecap="round" /></svg>
          <span className="faint" style={{ flex: 1, fontSize: 13 }}>Search or ask</span><span className="kbd">⌘K</span>
        </button>
      </div>
    </header>
  );
}
