'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useApi, useLive } from '@/lib/client/live';
import { StatusChip, Skeleton, ErrorCard, PageHead, Bar, Chip } from '@/components/ui';
import { int, pct } from '@/lib/client/format';
import { marsSubsolar } from '@/lib/engine/ephemeris';
import type { colonyView } from '@/lib/server/model';
import s from './colony.module.css';

const MarsGlobe = dynamic(() => import('@/components/globe/MarsGlobe'), { ssr: false });
type CV = ReturnType<typeof colonyView>;
const COLOR: Record<string, string> = { CRITICAL: '#DC2626', WATCH: '#D97706', NOMINAL: '#16A34A' };
const BAR: Record<string, string> = { CRITICAL: '#DC2626', WATCH: '#D97706', NOMINAL: '#12A150' };

export default function ColonyList() {
  const { data, error, reload } = useApi<{ colonies: CV[] }>('/api/colonies');
  const { state } = useLive();
  const router = useRouter();
  const [focus, setFocus] = useState<string | null>(null);
  const sub = useMemo(() => (state ? marsSubsolar(state.clock.jd) : null), [state?.clock.sol]); // eslint-disable-line react-hooks/exhaustive-deps
  const cols = useMemo(() => (data?.colonies ?? []).slice().sort((a, b) => a.lowest.days - b.lowest.days), [data]);
  const pins = useMemo(() => cols.map(c => ({ id: c.slug, lat: c.lat, lon: c.lon, color: COLOR[c.status], label: c.name, pulse: c.status === 'CRITICAL' })), [cols]);
  const f = cols.find(c => c.slug === focus);

  if (error && !data) return <main className="page"><ErrorCard what="colonies" onRetry={reload} /></main>;
  const people = cols.reduce((a, c) => a + c.population, 0);
  return (
    <main className="page">
      <PageHead title="Colonies" sub={data ? `${cols.length} towns on Mars, ${people} people. Each card shows how many days of air, water and food are left.` : 'Loading…'} actions={<Link className="btn" href="/app/logistics">Send a rover</Link>} />
      <div className={s.list}>
        <div className={s.cards}>
          {!data && [0, 1, 2, 3].map(i => <Skeleton key={i} h={210} />)}
          {cols.map(c => (
            <Link key={c.slug} href={`/app/colonies/${c.slug}`} className={`${s.ccard} fade-in`} onMouseEnter={() => setFocus(c.slug)} onFocus={() => setFocus(c.slug)}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <b style={{ fontSize: 15 }}>{c.name}</b><span style={{ marginLeft: 'auto' }}><StatusChip status={c.status} /></span>
              </div>
              <div className="faint" style={{ fontSize: 12.5 }}>{c.population} people</div>
              <div className={s.mini}>
                {c.stocks.map(x => (
                  <div key={x.resource}>
                    <div className="faint" style={{ fontSize: 11 }}>{x.resource === 'O2' ? 'Air' : x.resource === 'WATER' ? 'Water' : 'Food'}</div>
                    <div className="mono" style={{ fontSize: 17, fontWeight: 500, color: x.status === 'CRITICAL' ? 'var(--crit)' : x.status === 'WATCH' ? 'var(--warn)' : undefined }}>{int(x.days)}<span className="faint" style={{ fontSize: 11 }}> days</span></div>
                    <Bar value={Math.min(1, x.days / 120)} color={BAR[x.status]} />
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
                <span className="muted">Power</span><span className="mono">{pct(c.powerPct)}</span>
                <span style={{ marginLeft: 'auto' }}><Chip tone={c.agentOnline ? 'ok' : 'crit'}>{c.agentOnline ? 'AI online' : 'Not answering'}</Chip></span>
              </div>
            </Link>
          ))}
        </div>
        <section className={s.globeCard} aria-label="Colonies on Mars">
          {data && <MarsGlobe pins={pins} subsolar={sub} focus={f ? { lat: f.lat, lon: f.lon } : { lat: 25, lon: 120 }} zoom={0.72} hiRes onPick={id => router.push(`/app/colonies/${id}`)} />}
          <div style={{ position: 'absolute', left: 14, bottom: 12, fontSize: 11, color: '#8A919C', zIndex: 2 }}>Point at a colony to see it · click a name to open it</div>
        </section>
      </div>
    </main>
  );
}
