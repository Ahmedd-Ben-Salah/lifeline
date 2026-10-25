'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useApi, post, useMe, useLive } from '@/lib/client/live';
import { useToast } from '@/lib/client/toast';
import { Chip, Seg, Skeleton, ErrorCard, PageHead, KV, Kpi } from '@/components/ui';
import MarsMap, { Pin, MapDefs, MapText, type Proj, type LL } from '@/components/maps/MarsMap';
import { can } from '@/lib/auth/permissions';
import { distanceKm } from '@/lib/engine/geo';
import { f1, int, pct, slopeWord } from '@/lib/client/format';
import type { logistics as LogisticsFn } from '@/lib/server/views';
import st from './logistics.module.css';

type L = ReturnType<typeof LogisticsFn>;
type Rover = L['rovers'][number];
const STATUS_COLOR: Record<string, string> = { CRITICAL: '#DC2626', WATCH: '#D97706', NOMINAL: '#16A34A' };
const LABEL_COLOR: Record<string, string> = { CRITICAL: '#B91C1C', WATCH: '#9A4A07', NOMINAL: '#0E1116' };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const short = (n: string) => n.split(' ')[0];
const SOL_MS = 88775244;
const RES: Record<string, string> = { WATER: 'water', O2: 'air', FOOD: 'food' };
const rn = (code: string) => `Rover ${code.replace(/^r-/, '')}`;
const cargoText = (c: Record<string, number | undefined>) => Object.entries(c).filter(([, v]) => v).map(([k, v]) => `${int(v)} kg ${RES[k] ?? k}`).join(' · ');

function cumulative(path: LL[]) {
  const acc = [0];
  for (let i = 1; i < path.length; i++) acc.push(acc[i - 1] + distanceKm(path[i - 1], path[i]));
  return acc;
}
/** split a path at a fraction of its length → [driven, remaining] */
function splitPath(path: LL[], f: number): [LL[], LL[]] {
  const acc = cumulative(path), target = acc[acc.length - 1] * Math.max(0, Math.min(1, f));
  const i = acc.findIndex(a => a >= target);
  if (i <= 0) return [[path[0]], path];
  const t = (target - acc[i - 1]) / Math.max(1e-9, acc[i] - acc[i - 1]);
  const A = path[i - 1], B = path[i];
  const P = { lat: A.lat + (B.lat - A.lat) * t, lon: A.lon + (((B.lon - A.lon + 540) % 360) - 180) * t };
  return [[...path.slice(0, i), P], [P, ...path.slice(i)]];
}

function roverLine(r: Rover, colonyName: (s: string) => string) {
  switch (r.status) {
    case 'IN_TRANSIT': return r.route ? `${colonyName(r.route.from)} → ${colonyName(r.route.to)}` : 'In transit';
    case 'OFFLINE': return 'Broken down';
    case 'LOADING': return `Loading at ${colonyName(r.route?.from ?? r.home)}`;
    case 'MAINTENANCE': return 'Being repaired';
    default: return `Parked at ${colonyName(r.home)}`;
  }
}
const dotFor = (r: Rover) => (r.status === 'OFFLINE' ? 'dot-crit' : r.status === 'MAINTENANCE' ? 'dot-off' : r.status === 'IN_TRANSIT' ? 'dot-sig' : r.batteryPct < 60 ? 'dot-warn' : 'dot-ok');
const battColor = (r: Rover) => (r.status === 'OFFLINE' || r.batteryPct < 25 ? 'var(--crit-dot)' : r.batteryPct < 60 ? 'var(--warn-dot)' : 'var(--ok-dot)');

export default function Logistics() {
  const { data, error, reload } = useApi<L>('/api/logistics');
  const me = useMe();
  const [sel, setSel] = useState('r-7');
  const [tab, setTab] = useState<'MAP' | 'ELEV'>('MAP');
  const [modal, setModal] = useState(false);

  if (error && !data) return <main className="page"><ErrorCard what="logistics" onRetry={reload} /></main>;
  if (!data) return <main className="page"><Skeleton h={60} /><div className="kpis">{[0, 1, 2, 3].map(i => <Skeleton key={i} h={80} />)}</div><div className={st.lg}><Skeleton h={480} /><Skeleton h={480} /><Skeleton h={480} /></div></main>;

  const colonyName = (s: string) => short(data.colonies.find(c => c.slug === s)?.name ?? cap(s));
  const rover = data.rovers.find(r => r.code === sel) ?? data.rovers[0];
  const moving = data.transfers.filter(t => t.status === 'IN_TRANSIT');
  const next = moving.slice().sort((a, b) => a.etaSols - b.etaSols)[0];
  const offline = data.rovers.filter(r => r.status === 'OFFLINE');

  return (
    <main className="page">
      <PageHead title="Rovers" sub="Rovers drive supplies between colonies. The AI picks the safest road on the real Mars map, and finds a new one if a rover breaks down."
        actions={<>
          <Link className="btn" href="/app/comms/storm-s17">See the AI chat</Link>
          {can(me?.role, 'createTransfer') && <button className="btn btn-dark" onClick={() => setModal(true)}>Send a rover</button>}
        </>} />
      <div className="kpis">
        <Kpi label="Rovers working" value={data.active} unit={`of ${data.rovers.length}`} />
        <Kpi label="Supplies on the road" value={f1(moving.reduce((a, t) => a + t.mass, 0) / 1000)} unit="tonnes" />
        <Kpi label="Next delivery" value={next ? Math.round(next.etaSols) : '—'} unit={next ? `days · to ${colonyName(next.to)}` : ''} />
        <Kpi label="Broken rovers" value={data.faultsToday} unit={offline.length ? `· ${offline.map(r => rn(r.code)).join(', ')}` : ''} color={data.faultsToday ? 'var(--crit)' : undefined} />
      </div>

      <div className={st.lg}>
        <section className={`card ${st.fleet}`} aria-label="Fleet">
          <div className="card-h"><h2>Rovers</h2><span className="count-badge">{data.rovers.length}</span></div>
          {data.rovers.map(r => (
            <button key={r.code} className={st.rv} aria-current={r.code === sel} onClick={() => setSel(r.code)}>
              <span className={`dot ${dotFor(r)}`} />
              <b style={{ fontWeight: 500, whiteSpace: 'nowrap' }}>{rn(r.code)}</b>
              <span style={{ color: r.status === 'OFFLINE' ? 'var(--crit)' : r.status === 'MAINTENANCE' ? 'var(--ink-4)' : 'var(--ink-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{roverLine(r, colonyName)}</span>
              <span className={st.batt} style={{ marginLeft: 'auto' }} title={`Battery ${r.batteryPct}%`}><i style={{ width: `${r.batteryPct}%`, background: battColor(r) }} /></span>
            </button>
          ))}
        </section>

        <section className={`card ${st.mapc}`} aria-label="Route map">
          <div className="card-h"><h2>Map</h2><span className="faint" style={{ fontSize: 12 }}>{rn(rover.code)}{rover.route ? ` · ${colonyName(rover.route.from)} → ${colonyName(rover.route.to)}` : ''}</span>
            <div className="r"><Seg label="View" value={tab} onChange={setTab} options={[{ value: 'MAP', label: 'Map' }, { value: 'ELEV', label: 'Hills' }]} /></div></div>
          <div style={{ padding: 12 }}>
            {tab === 'MAP' ? <RouteMap data={data} sel={rover} onSel={setSel} colonyName={colonyName} /> : <Elevation data={data} rover={rover} colonyName={colonyName} />}
            <div className="legend" style={{ marginTop: 10, fontSize: 12 }}>
              <span><i style={{ width: 18, borderTop: '2px solid #0E1116' }} />Already driven</span>
              <span><i style={{ width: 18, borderTop: '2px dashed #0E1116' }} />Still to drive</span>
              <span><i style={{ width: 18, borderTop: '2px dotted #DC2626' }} />Old road (blocked)</span>
              <span><i style={{ width: 14, height: 8, borderRadius: 3, background: 'rgba(231,169,79,.45)' }} />Storm path</span>
              <span className="faint" style={{ marginLeft: 'auto' }}>Drag to pan · scroll to zoom</span>
            </div>
          </div>
        </section>

        <RoverCard data={data} rover={rover} colonyName={colonyName} />
      </div>

      <section className="card scroll-x" aria-label="Transfers">
        <div className="card-h"><h2>Deliveries</h2></div>
        <table className="table">
          <thead><tr><th>From</th><th>To</th><th>What</th><th>Rover</th><th>Arrives in</th><th>Status</th></tr></thead>
          <tbody>
            {data.transfers.map((t, ti) => (
              <tr key={`${t.code}-${ti}`} style={{ cursor: t.rover ? 'pointer' : undefined }} onClick={() => t.rover && setSel(t.rover)}>
                <td>{colonyName(t.from)}</td><td>{colonyName(t.to)}</td>
                <td>{cargoText(t.cargo)}</td><td>{t.rover ? rn(t.rover) : '—'}</td>
                <td>{t.status === 'IN_TRANSIT' || t.status === 'LOADING' ? `${Math.round(t.etaSols)} days` : '—'}</td>
                <td>{t.status === 'IN_TRANSIT' ? <Chip tone="info">On the way</Chip> : t.status === 'LOADING' ? <Chip tone="neutral">Loading</Chip> : t.status === 'FAILED' ? <Chip tone="crit">Rover broke · picked up by another</Chip> : t.status === 'DELIVERED' ? <Chip tone="ok">Delivered</Chip> : <Chip tone="neutral">{cap(t.status.toLowerCase())}</Chip>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {modal && <NewTransfer data={data} onClose={() => setModal(false)} onDone={() => setModal(false)} />}
    </main>
  );
}

/* ---------------- map ---------------- */
function RouteMap({ data, sel, onSel, colonyName }: { data: L; sel: Rover; onSel: (c: string) => void; colonyName: (s: string) => string }) {
  const frame = useMemo<LL[]>(() => {
    if (sel.route) {
      const path = sel.route.path, a = path[0], b = path[path.length - 1];
      const near = data.colonies.filter(c => Math.min(distanceKm(c, a), distanceKm(c, b)) < 2800);
      // pad north/south so a mostly east–west route still shows its surroundings
      const mid = path[Math.floor(path.length / 2)];
      return [...path.filter((_, i, arr) => i % Math.max(1, Math.floor(arr.length / 40)) === 0), b, ...near, { lat: mid.lat + 14, lon: mid.lon }, { lat: mid.lat - 14, lon: mid.lon }];
    }
    const home = data.colonies.find(c => c.slug === sel.home)!;
    return [sel.pos, ...data.colonies.filter(c => distanceKm(c, home) < 3500)];
  }, [sel, data.colonies]);
  return (
    <MarsMap frame={frame} frameKey={sel.code} aspect={0.62} minHeight={340} pad={0.24} ariaLabel={`Mars terrain map: rover routes; ${sel.code} selected`}>
      {proj => <RouteOverlay proj={proj} data={data} sel={sel} onSel={onSel} colonyName={colonyName} />}
    </MarsMap>
  );
}

function RouteOverlay({ proj, data, sel, onSel }: { proj: Proj; data: L; sel: Rover; onSel: (c: string) => void; colonyName: (s: string) => string }) {
  const s = data.storm;
  const r3 = data.rovers.find(r => r.status === 'OFFLINE');
  return (
    <g>
      <MapDefs />
      {s && <>
        <path d={proj.path([...s.cone.map(x => x.l90), ...s.cone.slice().reverse().map(x => x.r90)], true)} fill="#E7A94F" fillOpacity=".16" />
        <path d={proj.path([...s.cone.map(x => x.l67), ...s.cone.slice().reverse().map(x => x.r67)], true)} fill="#E7A94F" fillOpacity=".24" stroke="#FFF1DD" strokeOpacity=".5" strokeDasharray="5 5" />
      </>}
      {data.blockedRoute && <path d={proj.path(data.blockedRoute)} fill="none" stroke="#FFD2C8" strokeWidth="2.2" strokeDasharray="2 4" strokeLinecap="round" opacity=".95" />}
      {data.rovers.filter(r => r.route && r.status !== 'OFFLINE').map(r => {
        const on = r.code === sel.code;
        const [driven, rest] = splitPath(r.route!.path, r.status === 'IN_TRANSIT' ? r.progress : 0);
        return (
          <g key={r.code} onClick={() => onSel(r.code)} style={{ cursor: 'pointer' }} opacity={on ? 1 : 0.55}>
            <path d={proj.path(r.route!.path)} fill="none" stroke="transparent" strokeWidth="14" />
            {on && <path d={proj.path(r.route!.path)} fill="none" stroke="#0E1116" strokeOpacity=".35" strokeWidth="6" strokeLinecap="round" />}
            <path d={proj.path(rest)} fill="none" stroke="#fff" strokeWidth={on ? 2.6 : 1.8} strokeDasharray="7 6" strokeLinecap="round" />
            <path d={proj.path(driven)} fill="none" stroke="#fff" strokeWidth={on ? 3.2 : 2} strokeLinecap="round" />
          </g>
        );
      })}
      {data.colonies.map(c => <Pin key={c.slug} proj={proj} lat={c.lat} lon={c.lon} color={STATUS_COLOR[c.status]} labelColor={LABEL_COLOR[c.status]} label={short(c.name)} />)}
      {r3 && (() => {
        const [x, y] = proj.p(r3.pos.lat, r3.pos.lon);
        return (
          <g onClick={() => onSel(r3.code)} style={{ cursor: 'pointer' }}>
            <circle cx={x} cy={y} r={9} fill="#fff" stroke="#DC2626" strokeWidth={2} />
            <path d={`M${x - 3.6} ${y - 3.6}L${x + 3.6} ${y + 3.6}M${x + 3.6} ${y - 3.6}L${x - 3.6} ${y + 3.6}`} stroke="#DC2626" strokeWidth={2.2} strokeLinecap="round" />
            <g filter="url(#pillshadow)"><rect x={x - 46} y={y + 13} width={92} height={22} rx={11} fill="#fff" /></g>
            <text x={x} y={y + 28} textAnchor="middle" style={{ font: '600 12px var(--font)' }} fill="#B91C1C">{rn(r3.code)} broke</text>
          </g>
        );
      })()}
      {data.rovers.filter(r => r.status === 'IN_TRANSIT').map(r => {
        const [x, y] = proj.p(r.pos.lat, r.pos.lon);
        const on = r.code === sel.code;
        return (
          <g key={r.code} onClick={() => onSel(r.code)} style={{ cursor: 'pointer' }}>
            {on && <circle cx={x} cy={y} r={14} fill="#2F6FEB" opacity=".35" className="pulse" />}
            <circle cx={x} cy={y} r={7} fill="#2F6FEB" stroke="#fff" strokeWidth={2.5} />
            <g filter="url(#pillshadow)"><rect x={x - 32} y={y - 33} width={64} height={20} rx={10} fill="#2F6FEB" /></g>
            <text x={x} y={y - 19} textAnchor="middle" style={{ font: '600 12px var(--font)' }} fill="#fff">{rn(r.code)}</text>
          </g>
        );
      })}
      {s && (() => { const e = s.cone[Math.min(s.cone.length - 1, 6)]; const [x, y] = proj.p(e.centre.lat, e.centre.lon); return <MapText x={x + 8} y={y} size={11}>dust storm</MapText>; })()}
    </g>
  );
}

/* ---------------- elevation ---------------- */
function Elevation({ data, rover, colonyName }: { data: L; rover: Rover; colonyName: (s: string) => string }) {
  const prof = data.profiles[rover.code];
  if (!prof || !rover.route) return <div className="err-card" style={{ minHeight: 340, justifyContent: 'center' }}>{rn(rover.code)} is not driving right now. Pick a rover that is on the road.</div>;
  const W = 560, H = 330, x0 = 56, x1 = W - 14, y0 = 26, y1 = H - 42;
  const km = prof[prof.length - 1].km;
  const e0 = Math.min(...prof.map(p => p.elevM)), e1 = Math.max(...prof.map(p => p.elevM));
  const pad = Math.max(200, (e1 - e0) * 0.25), lo = e0 - pad, hi = e1 + pad;
  const x = (k: number) => x0 + (k / km) * (x1 - x0), y = (e: number) => y1 - ((e - lo) / (hi - lo)) * (y1 - y0);
  const line = prof.map((p, i) => `${i ? 'L' : 'M'}${x(p.km).toFixed(1)} ${y(p.elevM).toFixed(1)}`).join(' ');
  const here = rover.status === 'IN_TRANSIT' ? rover.progress * km : 0;
  const hp = prof.reduce((a, b) => (Math.abs(b.km - here) < Math.abs(a.km - here) ? b : a));
  const ticksE = Array.from({ length: 5 }, (_, i) => lo + ((hi - lo) * i) / 4);
  const kmStep = km > 4000 ? 1000 : km > 1500 ? 500 : 250;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`How high and low the road goes for ${rn(rover.code)}: ${int(km)} km`} style={{ display: 'block', background: 'var(--surface-2)', borderRadius: 12, border: '1px solid var(--line-2)' }}>
      <defs><linearGradient id="elevfill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#B5583B" stopOpacity=".55" /><stop offset="1" stopColor="#B5583B" stopOpacity=".08" /></linearGradient></defs>
      <g stroke="#EEF0F3">{ticksE.map(e => <path key={e} d={`M${x0} ${y(e)}H${x1}`} />)}</g>
      <g style={{ font: '400 10px var(--mono)' }} fill="#8A919C" textAnchor="end">{ticksE.map(e => <text key={e} x={x0 - 8} y={y(e) + 3}>{(e / 1000).toFixed(1)} km</text>)}</g>
      <path d={`${line} L${x(km)} ${y1} L${x(0)} ${y1}Z`} fill="url(#elevfill)" />
      <path d={line} fill="none" stroke="#B5583B" strokeWidth="2" />
      {here > 0 && <><line x1={x(here)} x2={x(here)} y1={y0} y2={y1} stroke="#2F6FEB" strokeDasharray="3 3" /><circle cx={x(here)} cy={y(hp.elevM)} r={5} fill="#2F6FEB" stroke="#fff" strokeWidth={2} /><text x={x(here) + 7} y={y0 + 12} style={{ font: '500 11px var(--font)' }} fill="#1F56C7">{rn(rover.code)} is here</text></>}
      <g style={{ font: '400 10px var(--mono)' }} fill="#5B6370" textAnchor="middle">
        {Array.from({ length: Math.floor(km / kmStep) + 1 }, (_, i) => i * kmStep).map(k => <text key={k} x={x(k)} y={y1 + 16}>{int(k)}</text>)}
        <text x={x1} y={y1 + 32} textAnchor="end" fill="#8A919C">km driven</text>
      </g>
      <text x={x0 + 4} y={y1 + 32} style={{ font: '600 11px var(--font)' }} fill="#3A414B">{colonyName(rover.route.from)}</text>
      <text x={x1} y={y0 + 2} textAnchor="end" style={{ font: '600 11px var(--font)' }} fill="#3A414B">{colonyName(rover.route.to)} · road is {slopeWord(rover.route.maxGradeDeg)}</text>
    </svg>
  );
}

/* ---------------- ring card ---------------- */
function RoverCard({ data, rover, colonyName }: { data: L; rover: Rover; colonyName: (s: string) => string }) {
  const r = rover.route, t = rover.transfer;
  const solNow = data.clock.solF;
  const departSol = r ? solNow - (data.clock.nowMs - r.departMs) / SOL_MS : null;
  // waypoint (e.g. recovering r-3's cargo): position along the route closest to the offline rover
  let via: { label: string; at: number } | null = null;
  if (r?.via) {
    const r3 = data.rovers.find(x => x.code === r.via);
    if (r3) {
      const acc = cumulative(r.path);
      let best = 0, bd = Infinity;
      r.path.forEach((p, i) => { const d = distanceKm(p, r3.pos); if (d < bd) { bd = d; best = i; } });
      via = { label: `Pick up ${rn(r3.code)}'s water`, at: (acc[best] / Math.max(1, acc[acc.length - 1])) * r.etaSols };
    }
  }
  const elapsed = r ? rover.progress * r.etaSols : 0;
  const stepState = (at: number) => (elapsed >= at ? 'done' : '');
  const statusChip = rover.status === 'OFFLINE' ? <Chip tone="crit">Broken down</Chip> : rover.status === 'IN_TRANSIT' ? <Chip tone="info">On the road</Chip> : rover.status === 'MAINTENANCE' ? <Chip tone="off">Being repaired</Chip> : rover.status === 'LOADING' ? <Chip tone="neutral">Loading</Chip> : <Chip tone="ok">Parked</Chip>;
  return (
    <section className="ring lift" aria-label={`Rover ${rover.code}`} style={{ alignSelf: 'start' }}>
      <div className="in">
        <div className="head">
          <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="9" width="16" height="6" rx="3" fill="none" stroke="#3A414B" strokeWidth="1.8" /><circle cx="8" cy="18" r="2" fill="none" stroke="#3A414B" strokeWidth="1.8" /><circle cx="16" cy="18" r="2" fill="none" stroke="#3A414B" strokeWidth="1.8" /></svg>
          <b>{rn(rover.code)}</b><span style={{ marginLeft: 'auto' }}>{statusChip}</span>
        </div>
        <div className="body">
          {t && <KV k="Carrying" v={cargoText(t.cargo)} />}
          {r && rover.status === 'IN_TRANSIT' && <KV k={`Reaches ${colonyName(r.to)} in`} v={`${Math.round(r.remainingSols)} days`} />}
          {r && <KV k="Trip length" v={`${int(r.km)} km`} />}
          {r && <KV k="Road" v={slopeWord(r.maxGradeDeg)} />}
          {rover.fault && <KV k="Problem" v={rover.status === 'OFFLINE' ? 'wheels stopped working' : rover.fault} vStyle={{ color: rover.status === 'OFFLINE' ? 'var(--crit)' : undefined }} />}
          <KV k="Battery" v={`${rover.batteryPct}%`} />
          {r && rover.status === 'IN_TRANSIT' && <div className="bar" role="progressbar" aria-label={`Trip progress ${pct(rover.progress)}`} aria-valuenow={Math.round(rover.progress * 100)}><i style={{ width: `${Math.max(1.5, rover.progress * 100)}%` }} /></div>}
        </div>
        {(t?.why || t?.reason) && <div className="sect"><span className="k">Why this route</span><span style={{ fontSize: 12.5 }}>{t.why ?? t.reason}</span></div>}
        {rover.status === 'OFFLINE' && <div className="sect"><span className="k">What happened</span><span style={{ fontSize: 12.5 }}>It broke down on the road from Utopia to Arcadia. Another rover is picking up its water.</span></div>}
        {r && departSol !== null && rover.status !== 'OFFLINE' && (
          <div className="sect">
            <div className={st.steps}>
              <div className={`${st.step} ${st.done}`}><span className={st.pt} /><span>{rover.status === 'LOADING' ? 'Loading' : 'Loaded'} at {colonyName(r.from)}</span><span className="faint" style={{ fontSize: 11.5 }}>day {int(Math.floor(departSol))}</span></div>
              {via && <div className={`${st.step} ${st[stepState(via.at)] ?? ''}`}><span className={st.pt} /><span>{via.label}</span><span className="faint" style={{ fontSize: 11.5 }}>in {Math.round(via.at)} days</span></div>}
              <div className={`${st.step} ${elapsed >= r.etaSols ? st.done : st.todo}`}><span className={st.pt} /><span>Arrive {colonyName(r.to)}</span><span className="faint" style={{ fontSize: 11.5 }}>in {Math.round(r.etaSols)} days</span></div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

/* ---------------- new transfer ---------------- */
function NewTransfer({ data, onClose, onDone }: { data: L; onClose: () => void; onDone: (code: string) => void }) {
  const toast = useToast();
  const { bump } = useLive();
  const standby = data.rovers.filter(r => r.status === 'STANDBY');
  const [rover, setRover] = useState(standby[0]?.code ?? '');
  const home = data.rovers.find(r => r.code === rover)?.home ?? data.colonies[0].slug;
  const [from, setFrom] = useState(home);
  const [to, setTo] = useState(data.colonies.find(c => c.slug !== home)?.slug ?? '');
  const [resource, setResource] = useState<'WATER' | 'O2' | 'FOOD'>('WATER');
  const [kg, setKg] = useState(500);
  const [busy, setBusy] = useState(false);
  const toEff = to === from ? (data.colonies.find(c => c.slug !== from)?.slug ?? '') : to;
  const fromC = data.colonies.find(c => c.slug === from), toC = data.colonies.find(c => c.slug === toEff);
  const straight = fromC && toC ? distanceKm(fromC, toC) : 0;
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await post<{ code: string; km: number; etaSols: number }>('/api/transfers', { from, to: toEff, rover, resource, kg: Number(kg) });
      toast(`Rover sent: ${int(r.km)} km, arrives in ${Math.round(r.etaSols)} days`);
      bump(); onDone(r.code);
    } catch (err) { toast((err as Error).message, true); } finally { setBusy(false); }
  }
  return (
    <div className="modal-bg" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="nt-title">
      <form className="modal fade-in" onClick={e => e.stopPropagation()} onSubmit={submit}>
        <div className="card-h"><h2 id="nt-title">Send a rover</h2><div className="r"><button type="button" className="btn btn-sm icon-btn" style={{ width: 28 }} aria-label="Close" onClick={onClose}>×</button></div></div>
        <div className="card-b" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div className="field"><label htmlFor="nt-from">From</label><select id="nt-from" className="select" value={from} onChange={e => setFrom(e.target.value)}>{data.colonies.map(c => <option key={c.slug} value={c.slug}>{c.name}</option>)}</select></div>
          <div className="field"><label htmlFor="nt-to">To</label><select id="nt-to" className="select" value={toEff} onChange={e => setTo(e.target.value)}>{data.colonies.filter(c => c.slug !== from).map(c => <option key={c.slug} value={c.slug}>{c.name}</option>)}</select></div>
          <div className="field"><label htmlFor="nt-rover">Rover</label><select id="nt-rover" className="select" value={rover} onChange={e => { setRover(e.target.value); const h = data.rovers.find(r => r.code === e.target.value)?.home; if (h) setFrom(h); }}>{standby.length ? standby.map(r => <option key={r.code} value={r.code}>{rn(r.code)} · at {colonyName(r.home, data)} · battery {r.batteryPct}%</option>) : <option value="">No free rover</option>}</select></div>
          <div className="field"><label htmlFor="nt-res">What to carry</label><select id="nt-res" className="select" value={resource} onChange={e => setResource(e.target.value as 'WATER')}><option value="WATER">Water</option><option value="O2">Air (oxygen)</option><option value="FOOD">Food</option></select></div>
          <div className="field" style={{ gridColumn: '1 / -1' }}><label htmlFor="nt-kg">How much (kg, up to 3,000)</label><input id="nt-kg" className="input" type="number" min={1} max={3000} step={10} value={kg} onChange={e => setKg(Number(e.target.value))} /></div>
          <div className="faint" style={{ gridColumn: '1 / -1', fontSize: 12.5 }}>Straight-line distance {int(straight)} km. The router plans the real drivable path on MOLA terrain and checks the sender keeps its {''}reserve policy.</div>
        </div>
        <div className="card-h" style={{ borderTop: '1px solid var(--line-2)', borderBottom: 0, justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-dark" disabled={busy || !rover || !toEff}>{busy ? 'Planning route…' : 'Plan & dispatch'}</button>
        </div>
      </form>
    </div>
  );
}
const colonyName = (s: string, data: L) => short(data.colonies.find(c => c.slug === s)?.name ?? s);
