'use client';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { Icons } from '@/components/ui';
import { useLive, post } from '@/lib/client/live';

const NAV = [
  { href: '/app', k: 'overview', label: 'Overview' },
  { href: '/app/traffic', k: 'traffic', label: '3D view' },
  { href: '/app/forecasts', k: 'forecasts', label: 'Storms' },
  { href: '/app/comms', k: 'comms', label: 'AI chat' },
  { href: '/app/logistics', k: 'logistics', label: 'Rovers' },
  { href: '/app/resupply', k: 'resupply', label: 'Earth orders' },
  { href: '/app/colonies', k: 'colonies', label: 'Colonies' },
] as const;
const SYS = [
  { href: '/app/automations', k: 'automations', label: 'Automations' },
  { href: '/app/policies', k: 'policies', label: 'Rules' },
  { href: '/app/settings', k: 'settings', label: 'Settings' },
] as const;

export default function Sidebar() {
  const path = usePathname();
  const router = useRouter();
  const { state } = useLive();
  const me = state?.me;
  const [menu, setMenu] = useState(false);
  const active = (href: string) => (href === '/app' ? path === '/app' : path.startsWith(href));
  const count = (k: string) => {
    if (k === 'forecasts' && state?.stormAlert) return <span className="count alert">{state.stormAlert}</span>;
    if (k === 'comms' && state?.threads) return <span className="count">{state.threads}</span>;
    if (k === 'resupply' && state?.needsYou) return <span className="count alert">{state.needsYou}</span>;
    return null;
  };
  const supplierOnly = me?.role === 'SUPPLIER';
  const items = (list: readonly { href: string; k: string; label: string }[]) => list.filter(n => !supplierOnly || n.k === 'resupply' || n.k === 'settings').map(n => (
    <Link key={n.k} href={n.href} aria-current={active(n.href) ? 'page' : undefined} prefetch>
      {Icons[n.k as keyof typeof Icons]}{n.label}{count(n.k)}
    </Link>
  ));
  const org = me?.site === 'earth' ? { sq: 'EA', name: me.role === 'SUPPLIER' ? 'Cargo supplier' : 'Earth control', tag: me.role === 'SUPPLIER' ? 'Supply' : 'Earth' } : { sq: (me?.colony ?? 'jz').slice(0, 2).toUpperCase(), name: me?.colony ? `${me.colony[0].toUpperCase()}${me.colony.slice(1)} ${me.colony === 'jezero' ? 'Base' : me.colony === 'utopia' ? 'Outpost' : ''}`.trim() : 'Mars network', tag: 'Ops' };
  async function signOut() { await post('/api/auth/logout'); router.push('/login'); router.refresh(); }
  return (
    <aside className="sidebar">
      <Link className="brand" href="/app" style={{ color: 'inherit' }}><Image src="/logo.svg" width={30} height={19} alt="" priority /><b>lifeline</b></Link>
      <div className="org"><span className="sq">{org.sq}</span><span>{org.name}</span><span className="faint" style={{ marginLeft: 'auto', fontSize: 12 }}>{org.tag}</span></div>
      <nav className="nav" aria-label="Main">
        {items(NAV)}
        {!supplierOnly && <div className="nav-label">SYSTEM</div>}
        {items(SYS)}
      </nav>
      <div className="me" style={{ position: 'relative' }}>
        <span className="avatar">{(me?.name ?? '··').split(' ').map(x => x[0]).join('').slice(0, 2).toUpperCase()}</span>
        <div style={{ minWidth: 0 }}><div style={{ fontSize: 13, fontWeight: 500 }}>{me?.name ?? '…'}</div><div className="faint" style={{ fontSize: 12 }}>{me?.title ?? ''} · {me?.role?.toLowerCase()}</div></div>
        <button className="btn btn-sm icon-btn" style={{ marginLeft: 'auto', width: 28 }} aria-label="Account menu" aria-expanded={menu} onClick={() => setMenu(m => !m)}>
          <svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="19" cy="12" r="1.2" /></svg>
        </button>
        {menu && (
          <div className="card fade-in" style={{ position: 'absolute', bottom: 54, left: 8, right: 8, padding: 6, boxShadow: 'var(--sh-3)', zIndex: 30 }} onMouseLeave={() => setMenu(false)}>
            <Link className="btn btn-sm" style={{ width: '100%', justifyContent: 'flex-start', border: 0 }} href="/app/settings" onClick={() => setMenu(false)}>Settings</Link>
            <button className="btn btn-sm" style={{ width: '100%', justifyContent: 'flex-start', border: 0, color: 'var(--crit)' }} onClick={signOut}>Sign out</button>
          </div>
        )}
      </div>
    </aside>
  );
}
