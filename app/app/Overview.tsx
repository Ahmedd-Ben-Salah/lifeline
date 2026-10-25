'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useApi, useNow, post, useLive, useMe } from '@/lib/client/live';
import { useToast } from '@/lib/client/toast';
import { Kpi, Spark, RingCard, KV, ProtocolTag, StatusChip, Seg, Skeleton, ErrorCard, PageHead, DelayRing, Icons, agentName } from '@/components/ui';
import { int, f1, pct, mmss, RES_SHORT, RES_LABEL } from '@/lib/client/format';
import { marsSubsolar } from '@/lib/engine/ephemeris';
import { can } from '@/lib/auth/permissions';
import type { overview as OverviewFn } from '@/lib/server/views';

const MarsGlobe = dynamic(() => import('@/components/globe/MarsGlobe'), { ssr: false, loading: () => <div className="skel" style={{ position: 'absolute', inset: 40, borderRadius: '50%' }} /> });
type O = ReturnType<typeof OverviewFn>;
const STATUS_COLOR: Record<string, string> = { CRITICAL: '#DC2626', WATCH: '#D97706', NOMINAL: '#16A34A' };

export default function Overview() {
  const { data, error, reload } = useApi<O>('/api/overview');
  const me = useMe();
  const now = useNow(1000);
  const toast = useToast();
  const { bump } = useLive();
  const [horizon, setHorizon] = useState<'OUTLOOK' | 'WATCH' | 'TRACK'>('TRACK');
  const [busy, setBusy] = useState(false);

  const globe = useMemo(() => {
    if (!data) return null;
    const pins = data.colonies.map(c => ({ id: c.slug, lat: c.lat, lon: c.lon, color: STATUS_COLOR[c.status], label: horizon === 'OUTLOOK' ? `${c.name.split(' ')[0]}` : c.name.split(' ')[0], pulse: c.status === 'CRITICAL' }));
    const rovers = data.rovers.filter(r => r.status === 'IN_TRANSIT' && r.route).map(r => ({ id: r.code, points: r.route!.path, color: '#9DBCF7', dashed: true }));
    const dead = data.rovers.filter(r => r.status === 'OFFLINE').map(r => ({ id: r.code, lat: r.pos.lat, lon: r.pos.lon, color: '#DC2626', label: `Rover ${r.code.replace('r-', '')} broke`, size: 0.7 }));
    const nearColony = (p: { lat: number; lon: number }) => data.colonies.some(c => Math.hypot(c.lat - p.lat, ((c.lon - p.lon + 540) % 360) - 180) < 6);
    const moving = data.rovers.filter(r => r.status === 'IN_TRANSIT').map(r => ({ id: r.code, lat: r.pos.lat, lon: r.pos.lon, color: '#2F6FEB', label: nearColony(r.pos) ? undefined : `Rover ${r.code.replace('r-', '')}`, size: 0.7 }));
    const cone = horizon === 'TRACK' && data.storm ? { origin: data.storm.originLatLon, edges: data.storm.cone } : null;
    return { pins: [...pins, ...(horizon === 'TRACK' ? [...dead, ...moving] : [])], lines: horizon === 'TRACK' ? rovers : [], cone };
  }, [data, horizon]);
  const sub = useMemo(() => (data ? marsSubsolar(data.clock.jd) : null), [data?.clock.sol]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error && !data) return <main className="page"><ErrorCard what="the overview" onRetry={reload} /></main>;
  if (!data) return <main className="page"><Skeleton h={60} /><div className="kpis">{[0, 1, 2, 3].map(i => <Skeleton key={i} h={92} />)}</div><div className="split"><Skeleton h={470} /><Skeleton h={470} /></div></main>;

  const k = data.kpis;
  const order = data.order;
  const canApprove = can(me?.role, 'approveOrder') && order?.status === 'AWAITING_APPROVAL' && !order.approvals.some(a => a.userEmail === me?.email);
  async function approve() {
    if (!order) return;
    setBusy(true);
    try { const r = await post<{ arrivesInMs: number }>(`/api/orders/${order.code}/approve`, { decision: 'GO' }); toast(r.arrivesInMs > 0 ? `Approved. Your OK reaches Earth in ${mmss(r.arrivesInMs)}` : 'Approved'); bump(); }
    catch (e) { toast((e as Error).message, true); } finally { setBusy(false); }
  }
  const dd = Math.floor(k.window.daysLeft);
  const hour = new Date(now).getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const low = k.lowest;
  const headline = [
    low.days < 30 ? `${low.colony.split(' ')[0]} is low on ${RES_SHORT[low.resource]}.` : 'All colonies have enough supplies.',
    k.storm ? 'A dust storm is coming.' : '',
    data.needsYou ? (data.needsYou === 1 ? 'One decision needs you.' : `${data.needsYou} decisions need you.`) : 'Nothing needs you right now.',
  ].filter(Boolean).join(' ');

  return (
    <main className="page">
      <PageHead title={`${greet}, ${me?.name.split(' ')[0] ?? ''}`}
        sub={headline}
        actions={<><Link className="btn" href="/app/traffic">{Icons.traffic}Open 3D view</Link><Link className="btn btn-dark" href="/app/resupply">Review Earth order</Link></>} />

      <div className="kpis">
        <Kpi label={`${RES_LABEL[k.lowest.resource]} left at ${k.lowest.colony.split(' ')[0]}`} value={int(k.lowest.days)} unit="days"  color={k.lowest.days < 30 ? 'var(--crit)' : k.lowest.days < 60 ? 'var(--warn)' : undefined} right={<Spark values={k.lowest.spark} color="#DC2626" />} />
        {k.storm ? <Kpi label={`Dust storm reaches ${k.storm.target.split(' ')[0]} · ${Math.round(k.storm.probability * 100)}% chance`} value={`${Math.round(k.storm.arrivalMin ?? 0)}–${Math.round(k.storm.arrivalMax ?? 0)}`} unit="days" right={<Spark values={k.storm.hist} color="#D97706" />} />
          : <Kpi label="No storm coming" value="—" />}
        <Kpi label={`Supplies on the road${k.cargo.etaSols !== null ? ` · next arrives in ${Math.round(k.cargo.etaSols)} days` : ''}`} value={f1(k.cargo.tonnes)} unit="tonnes" right={<Spark values={[0.4, 0.42, 0.41, 0.6, 0.65, k.cargo.tonnes]} color="#2F6FEB" />} />
        <Kpi label="Next rockets can leave Earth in" value={int(dd)} unit="days" right={<svg width="34" height="34" viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="15" fill="none" stroke="#EEF0F3" strokeWidth="4" /><circle cx="18" cy="18" r="15" fill="none" stroke="#2F6FEB" strokeWidth="4" strokeLinecap="round" strokeDasharray={`${Math.max(2, k.window.synodicFrac * 94)} 94`} transform="rotate(-90 18 18)" /></svg>} />
      </div>

      <div className="split">
        <section className="planet" aria-label="Planet view" style={{ background: '#05070B', borderColor: '#1a1d24' }}>
          <div className="tl"><Seg label="Forecast horizon" value={horizon} onChange={setHorizon} options={[{ value: 'OUTLOOK', label: 'Next season' }, { value: 'WATCH', label: 'Next weeks' }, { value: 'TRACK', label: 'Next days' }]} /></div>
          <div className="tr">
            {horizon === 'TRACK' && <><span className="pill-btn"><span style={{ width: 14, height: 8, borderRadius: 3, background: 'rgba(217,119,6,.22)', border: '1px dashed #B45309' }} />Storm path</span><span className="pill-btn"><span style={{ width: 14, borderTop: '2px dashed #2F6FEB' }} />Rover route</span></>}
            {horizon !== 'TRACK' && <span className="pill-btn">{horizon === 'OUTLOOK' ? 'Dust season risk' : 'Dust building up'}</span>}
          </div>
          <div className="globe">{globe && <MarsGlobe pins={globe.pins} lines={globe.lines} cone={globe.cone} subsolar={sub} focus={horizon === 'TRACK' ? { lat: 22, lon: 150 } : horizon === 'WATCH' ? { lat: 0, lon: -50 } : { lat: 20, lon: 60 }} zoom={1.05} />}</div>
          {data.storm && horizon === 'TRACK' && (
            <RingCard className="bl" title="Dust storm" right={<span className="chip chip-crit"><span className="d" />Coming</span>}>
              <KV k="Heading to" v={data.storm.targetName.split(' ')[0]} />
              <KV k="Solar power drops" v={pct(data.storm.solarLossMax)} />
              <KV k="Based on" v={`${data.storm.runs} simulations`} />
            </RingCard>
          )}
          {horizon !== 'TRACK' && (
            <RingCard className="bl" title={horizon === 'OUTLOOK' ? 'Next season' : 'Next weeks'} right={<span className="chip chip-warn"><span className="d" />Watch</span>}>
              {horizon === 'OUTLOOK' ? <><KV k="Now" v="Dust season" /><KV k="Big storms" v="1 year in 5" /><KV k="Plan" v="Order from Earth early" /></>
                : <><KV k="Near Valles" v="dust building" /><KV k="Near Jezero" v="dust building" /><KV k="Warning time" v="a few weeks" /></>}
            </RingCard>
          )}
          <Link className="br btn btn-sm" href="/app/forecasts">See storm forecast</Link>
        </section>

        <section className="card" aria-label="Agent stream" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div className="card-h"><h2>What the AIs are doing</h2><span className="chip chip-ok"><span className="d" />live</span><div className="r"><Link href="/app/comms" style={{ fontSize: 12.5 }}>Open AI chat</Link></div></div>
          {data.stream.map((m, i) => {
            const inTransit = m.deliverMs > now && m.crossesLink;
            const isOrder = m.kind === 'ORDER';
            return (
              <div key={m.id} className="stream-row fade-in" style={{ gridTemplateColumns: '46px 96px minmax(0,1fr)', background: isOrder && order?.status === 'AWAITING_APPROVAL' ? '#F7FAFF' : undefined, borderBottom: i === data.stream.length - 1 ? 0 : undefined }}>
                <span className="ts">{m.time}</span>
                <span>{inTransit ? <span className="delay"><DelayRing startMs={m.createdMs} endMs={m.deliverMs} now={now} size={13} />{mmss(m.deliverMs - now)}</span> : <ProtocolTag kind={m.kind} />}</span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
                  <span className={inTransit ? 'muted' : undefined}>{inTransit ? `Message on its way to ${m.to?.startsWith('earth') ? 'Earth' : 'Mars'}` : streamLine(m)}</span>
                  {isOrder && order?.status === 'AWAITING_APPROVAL' && (
                    <div style={{ display: 'flex', gap: 6 }}>
                      {canApprove && <button className="btn btn-sm btn-dark" disabled={busy} onClick={approve}>{busy ? 'Sending…' : 'Approve'}</button>}
                      <Link className="btn btn-sm" href="/app/resupply">See order</Link>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </section>
      </div>

      <section className="card scroll-x" aria-label="Colonies">
        <table className="table">
          <thead><tr><th>Colony</th><th>People</th><th>Air · days left</th><th>Water · days left</th><th>Food · days left</th><th>Power</th><th>Status</th></tr></thead>
          <tbody>
            {data.colonies.slice().sort((a, b) => a.lowest.days - b.lowest.days).map(c => {
              const d = (r: string) => c.stocks.find(s => s.resource === r)!;
              const col = (s: { status: string }) => (s.status === 'CRITICAL' ? 'var(--crit)' : s.status === 'WATCH' ? 'var(--warn)' : undefined);
              return (
                <tr key={c.slug}>
                  <td><Link href={`/app/colonies/${c.slug}`} style={{ color: 'var(--ink)', fontWeight: 500 }}>{c.name}</Link>{!c.agentOnline && <div style={{ fontSize: 12, color: 'var(--warn)' }}>not answering</div>}</td>
                  <td className="num">{c.population}</td>
                  {(['O2', 'WATER', 'FOOD'] as const).map(r => <td key={r} className="num" style={{ color: col(d(r)) }}>{int(d(r).days)}</td>)}
                  <td className="num">{pct(c.powerPct)}</td>
                  <td><StatusChip status={c.status} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </main>
  );
}

function streamLine(m: O['stream'][number]) {
  const who = agentName(m.from);
  const first = m.body.split(/(?<=\.)\s/)[0];
  switch (m.kind) {
    case 'ASK': return `${m.askedBy ?? who} asked: ${m.body}`;
    case 'TIMEOUT': return 'Arcadia did not answer, so Jezero AI acts on its own.';
    default: return `${who}: ${first}`;
  }
}
