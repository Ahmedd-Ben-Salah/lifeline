'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useApi, post, useMe, useLive } from '@/lib/client/live';
import { useToast } from '@/lib/client/toast';
import { Chip, RingCard, KV, Seg, Skeleton, ErrorCard, PageHead } from '@/components/ui';
import MarsMap, { Pin, MapDefs, MapText, kmPerDeg, type Proj, type LL } from '@/components/maps/MarsMap';
import { can } from '@/lib/auth/permissions';
import { f1, f2, int, pct, date, dustLevel } from '@/lib/client/format';
import { marsLs, dateFromJd } from '@/lib/engine/ephemeris';
import { seasonActivity } from '@/lib/engine/season';
import type { forecasts as ForecastsFn } from '@/lib/server/views';
import st from './forecasts.module.css';

type F = ReturnType<typeof ForecastsFn>;
type Storm = NonNullable<F['storm']>;
type H = 'OUTLOOK' | 'WATCH' | 'TRACK';
const STATUS_COLOR: Record<string, string> = { CRITICAL: '#DC2626', WATCH: '#D97706', NOMINAL: '#16A34A' };
const LABEL_COLOR: Record<string, string> = { CRITICAL: '#B91C1C', WATCH: '#9A4A07', NOMINAL: '#0E1116' };
const short = (n: string) => n.split(' ')[0];

export default function Forecasts() {
  const { data, error, reload } = useApi<F>('/api/forecasts');
  const me = useMe();
  const toast = useToast();
  const { bump } = useLive();
  const [h, setH] = useState<H>('TRACK');
  const [running, setRunning] = useState(false);
  const [ranAt, setRanAt] = useState<string | null>(null);
  const [tracks, setTracks] = useState(false);

  async function rerun() {
    setRunning(true);
    const t0 = performance.now();
    try {
      const r = await post<{ runs: number; seed: number }>('/api/forecasts/run');
      await new Promise(res => setTimeout(res, Math.max(0, 2000 - (performance.now() - t0))));
      setRanAt(`Checked again: same ${r.runs} simulations, same answer`);
      toast(`Forecast checked again (${r.runs} simulations)`);
      bump();
    } catch (e) { toast((e as Error).message, true); } finally { setRunning(false); }
  }

  if (error && !data) return <main className="page"><ErrorCard what="forecasts" onRetry={reload} /></main>;
  if (!data) return <main className="page"><Skeleton h={60} /><div className={st.fc}><Skeleton h={520} /><Skeleton h={520} /></div></main>;

  const s = data.storm;
  return (
    <main className="page">
      <PageHead title="Dust storm forecast" sub="Like a weather app for Mars. We simulate the storm 300 times to see where it will most likely go."
        actions={<>
          <Seg label="Horizon" value={h} onChange={setH} options={[{ value: 'OUTLOOK', label: 'Next season' }, { value: 'WATCH', label: 'Next weeks' }, { value: 'TRACK', label: 'Next days' }]} />
          {can(me?.role, 'runForecast') && (
            <button className="btn" onClick={rerun} disabled={running}>
              <svg viewBox="0 0 24 24" className={running ? 'spin' : undefined}><path d="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3M18 3v4h-4M6 21v-4h4" /></svg>{running ? 'Simulating…' : 'Check again'}
            </button>
          )}
        </>} />

      {h === 'TRACK' && (s ? <Track data={data} s={s} running={running} ranAt={ranAt} tracks={tracks} setTracks={setTracks} /> : <div className="err-card">No storm is being tracked right now.</div>)}
      {h === 'WATCH' && <Watch data={data} />}
      {h === 'OUTLOOK' && <Outlook data={data} />}

      <section className="card scroll-x" aria-label="All storms">
        <div className="card-h"><h2>All storms we are watching</h2></div>
        <table className="table">
          <thead><tr><th>Where it started</th><th>Colony at risk</th><th>Chance</th><th>When</th><th>Status</th></tr></thead>
          <tbody>
            {s && <tr><td>{s.origin}</td><td>{short(s.targetName)}</td><td className="num">{pct(s.probability)}</td><td>in {Math.round(s.arrivalMin ?? 0)}–{Math.round(s.arrivalMax ?? 0)} days</td><td>{s.status === 'RESPONSE' ? <Chip tone="crit">Help on the way</Chip> : <Chip tone="warn">Watching</Chip>}</td></tr>}
            {data.watch.map(w => <tr key={w.code}><td>{w.origin}</td><td>{data.colonies.find(c => c.slug === w.target)?.name ?? '—'}</td><td className="num">{pct(w.probability)}</td><td>in 2–5 weeks</td><td><Chip tone="warn">Watching</Chip></td></tr>)}
            <tr><td>Anywhere on Mars</td><td>All colonies</td><td className="num">{pct(data.outlook.globalRate.rate)}</td><td>next dust season</td><td><Chip tone="info">Earth order planned</Chip></td></tr>
          </tbody>
        </table>
      </section>
    </main>
  );
}

/* ---------------- TRACK ---------------- */
function Track({ data, s, running, ranAt, tracks, setTracks }: { data: F; s: Storm; running: boolean; ranAt: string | null; tracks: boolean; setTracks: (b: boolean) => void }) {
  const target = data.colonies.find(c => c.slug === s.target)!;
  const frame = useMemo<LL[]>(() => [s.originLatLon, ...s.cone.flatMap(c => [c.l67, c.r67]), ...data.colonies.filter(c => c.slug !== 'valles')], [s, data.colonies]);
  const tgtImpact = s.impacts.find(i => i.slug === s.target)!;
  return (
    <>
      <div className={st.fc}>
        <section className="card" aria-label="Track map" style={{ overflow: 'hidden', alignSelf: 'start' }}>
          <div className="card-h">
            <h2>Where the storm is going</h2><Chip tone="crit">Coming</Chip>
            <div className="r">
              <label className="faint" style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" className="toggle" checked={tracks} onChange={e => setTracks(e.target.checked)} aria-label="Show some of the simulations" />Show simulations
              </label>
            </div>
          </div>
          <div style={{ padding: 12, position: 'relative' }}>
            {running && <div className={st.runOverlay}><span className="spin" style={{ width: 18, height: 18, border: '2px solid #fff', borderTopColor: 'transparent', borderRadius: 99, display: 'inline-block' }} />Running 300 simulations…</div>}
            <MarsMap frame={frame} refLon={target.lon} aspect={0.84} minHeight={420} ariaLabel={`Mars terrain map with storm ${s.code} cone from ${s.origin} toward ${s.targetName}, probability ${f2(s.probability)}`}
              corner={<div className={st.legend}>
                <span><i style={{ width: 22, height: 10, borderRadius: 4, background: 'rgba(231,169,79,.5)', border: '1px dashed #B45309' }} />Likely path</span>
                <span><i style={{ width: 22, height: 10, borderRadius: 4, background: 'rgba(231,169,79,.25)' }} />Possible path</span>
              </div>}>
              {proj => <TrackOverlay proj={proj} data={data} s={s} tracks={tracks} />}
            </MarsMap>
          </div>
        </section>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <RingCard lift title="Dust storm from Hellas" right={<span className="live-dot" />}
            sect={<div className="sect"><span className="k">What we are doing</span><div style={{ display: 'flex', gap: 6 }}><Link className="btn btn-sm btn-dark" href="/app/comms/storm-s17">See the AI chat</Link><Link className="btn btn-sm" href="/app/logistics">See the rover</Link></div></div>}>
            <div style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.35 }}>{pct(s.probability)} chance it reaches {short(s.targetName)} in {Math.round(s.arrivalMin ?? 0)}–{Math.round(s.arrivalMax ?? 0)} days</div>
            <KV k="Most likely in" v={`${Math.round(s.arrivalMedian ?? 0)} days`} />
            <KV k="Dust level" v={dustLevel(s.tauMax)} />
            <KV k="Solar power drops" v={pct(s.solarLossMax)} />
            <KV k="Lasts about" v={`${Math.round(s.durationSols)} days`} />
            <KV k="Based on" v={`${s.runs} simulations`} />
            {ranAt && <div className="chip chip-ok" style={{ alignSelf: 'flex-start' }}><span className="d" />{ranAt}</div>}
          </RingCard>
          <div className="card">
            <div className="card-h"><h2>Why we think this</h2></div>
            <div className="card-b" style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
              {[
                'The air near Hellas got much dustier in just 3 days.',
                'It is dust season on Mars, when big storms usually start.',
                `In ${tgtImpact.runsReached} of our ${s.runs} simulations, the storm reached ${short(s.targetName)}.`,
              ].map((t, i) => <div key={i} style={{ display: 'flex', gap: 10 }}><span className="tag t-info">{i + 1}</span><span>{t}</span></div>)}
            </div>
          </div>
        </div>
      </div>

      <div className={st.charts}>
        <section className="card" aria-label="Arrival distribution">
          <div className="card-h"><h2>When could it reach {short(s.targetName)}?</h2><div className="r"><span className="faint" style={{ fontSize: 12 }}>simulations per day</span></div></div>
          <div className="card-b"><Histogram s={s} /></div>
        </section>
        <section className="card" aria-label="Impact per colony">
          <div className="card-h"><h2>Which colonies are at risk?</h2></div>
          <table className="table">
            <thead><tr><th>Colony</th><th>Chance</th><th>When</th><th>Dust level</th></tr></thead>
            <tbody>
              {s.impacts.slice().sort((a, b) => b.probability - a.probability).map(i => (
                <tr key={i.slug}>
                  <td style={{ fontWeight: 500 }}><Link href={`/app/colonies/${i.slug}`} style={{ color: 'var(--ink)' }}>{i.name}</Link></td>
                  <td><div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><span className="num" style={{ width: 38, color: i.probability >= 0.7 ? 'var(--crit)' : i.probability >= 0.3 ? 'var(--warn)' : undefined }}>{pct(i.probability)}</span><div className="bar" style={{ width: 90 }}><i style={{ width: `${i.probability * 100}%`, background: i.probability >= 0.7 ? 'var(--crit-dot)' : i.probability >= 0.3 ? 'var(--warn-dot)' : 'var(--ink-5)' }} /></div></div></td>
                  <td>{i.arrivalP10 === null ? '—' : `in ${Math.max(0, Math.round(i.arrivalP10))}–${Math.round(i.arrivalP90 ?? 0)} days`}</td>
                  <td>{i.tauP10 === null ? '—' : dustLevel(i.tauP90)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </>
  );
}

function TrackOverlay({ proj, data, s, tracks }: { proj: Proj; data: F; s: Storm; tracks: boolean }) {
  const c = s.cone;
  const p90 = proj.path([...c.map(x => x.l90), ...c.slice().reverse().map(x => x.r90)], true);
  const p67 = proj.path([...c.map(x => x.l67), ...c.slice().reverse().map(x => x.r67)], true);
  const centre = proj.path(c.map(x => x.centre));
  const [ox, oy] = proj.p(s.originLatLon.lat, s.originLatLon.lon);
  const coreR = Math.max(14, (350 / kmPerDeg) * proj.s);
  const labelsAt = [4, 8, 12].map(n => c.find(x => Math.round(x.sol) === n) ?? c.reduce((a, b) => (Math.abs(b.sol - n) < Math.abs(a.sol - n) ? b : a)));
  const [cx, cy] = proj.p(s.currentCentre.lat, s.currentCentre.lon);
  return (
    <g>
      <MapDefs />
      <path d={p90} fill="#E7A94F" fillOpacity=".2" />
      <path d={p67} fill="#E7A94F" fillOpacity=".36" stroke="#FFF1DD" strokeWidth="1.6" strokeDasharray="6 5" strokeLinejoin="round" />
      {tracks && s.sampleTracks.map((t, i) => <path key={i} d={proj.path(t)} fill="none" stroke="#FFF1DD" strokeOpacity=".35" strokeWidth="1" />)}
      <path d={centre} fill="none" stroke="#FFF1DD" strokeWidth="1.8" strokeDasharray="2 6" strokeLinecap="round" />
      {labelsAt.map((x, i) => { const [lx, ly] = proj.p(x.centre.lat, x.centre.lon); return <g key={i}><circle cx={lx} cy={ly} r={3} fill="#FFF1DD" /><MapText x={lx + 8} y={ly - 6} mono>{`day ${[4, 8, 12][i]}`}</MapText></g>; })}
      <circle cx={ox} cy={oy} r={coreR * 1.6} fill="url(#dustcore)" />
      <circle cx={ox} cy={oy} r={7} fill="#FFF1DD" />
      <circle cx={ox} cy={oy} r={14} fill="none" stroke="#FFF1DD" strokeOpacity=".55" />
      <MapText x={ox} y={oy + coreR * 0.9 + 22} anchor="middle">Storm starts here</MapText>
      {s.ageSols > 0.2 && <circle cx={cx} cy={cy} r={5} fill="none" stroke="#FFF1DD" strokeWidth="2" />}
      {data.colonies.map(col => <Pin key={col.slug} proj={proj} lat={col.lat} lon={col.lon} color={STATUS_COLOR[col.status]} labelColor={LABEL_COLOR[col.status]} label={short(col.name)} big={col.slug === s.target} pulse={col.slug === s.target} />)}
    </g>
  );
}

function Histogram({ s }: { s: Storm }) {
  const hist = s.histogram;
  const W = 520, Hh = 200, x0 = 40, x1 = 510, y0 = 20, y1 = 170;
  const max = Math.max(...hist.map(h => h.runs), 1);
  const top = Math.ceil((max * 1.22) / 10) * 10;
  const n = hist.length, bw = (x1 - x0) / n;
  const lo = Math.round(s.arrivalMin ?? 0), hi = Math.round(s.arrivalMax ?? 0);
  const bandL = hist.findIndex(h => h.sol >= lo), bandR = hist.findIndex(h => h.sol > hi);
  const peak = hist.reduce((a, b) => (b.runs > a.runs ? b : a), hist[0]);
  const y = (v: number) => y1 - (v / top) * (y1 - y0);
  return (
    <svg viewBox={`0 0 ${W} ${Hh}`} width="100%" role="img" aria-label={`Chart of when the storm could reach ${s.targetName}: most likely between day ${lo} and ${hi}`}>
      <g stroke="#EEF0F3">{[0, 0.33, 0.66, 1].map(f => <path key={f} d={`M${x0} ${y(top * f)}H${x1}`} />)}</g>
      <g style={{ font: '400 10px var(--mono)' }} fill="#8A919C">{[0, 0.33, 0.66, 1].map(f => <text key={f} x={32} y={y(top * f) + 4} textAnchor="end">{Math.round(top * f)}</text>)}</g>
      {bandL >= 0 && <rect x={x0 + bandL * bw} y={y0} width={((bandR < 0 ? n : bandR) - bandL) * bw} height={y1 - y0} fill="#EEF4FF" />}
      <g fill="#2F6FEB">{hist.map((h, i) => <rect key={h.sol} x={x0 + i * bw + 4} y={y(h.runs)} width={Math.max(2, bw - 8)} height={Math.max(0, y1 - y(h.runs))} rx={3} />)}</g>
      <g style={{ font: '400 10px var(--mono)' }} fill="#5B6370" textAnchor="middle">{hist.map((h, i) => (n <= 14 || i % 2 === 0) && <text key={h.sol} x={x0 + i * bw + bw / 2} y={188}>{h.sol}</text>)}</g>
      {bandL >= 0 && <text x={x0 + (bandL + ((bandR < 0 ? n : bandR) - bandL) / 2) * bw} y={34} style={{ font: '400 11px var(--font)' }} fill="#1F56C7" textAnchor="middle">most likely: day {lo}–{hi}</text>}
    </svg>
  );
}

/* ---------------- WATCH ---------------- */
function Watch({ data }: { data: F }) {
  const frame = useMemo<LL[]>(() => [...data.watch.map(w => w.region), ...data.colonies.filter(c => c.slug === 'valles' || c.slug === 'jezero')], [data]);
  const [sel, setSel] = useState(data.watch[0]?.code);
  return (
    <div className={st.fc}>
      <section className="card" aria-label="Watch map" style={{ overflow: 'hidden', alignSelf: 'start' }}>
        <div className="card-h"><h2>Dusty areas that might become storms</h2><Chip tone="warn">Watching</Chip></div>
        <div style={{ padding: 12 }}>
          <MarsMap frame={frame} frameKey="watch" refLon={-50} aspect={0.56} minHeight={360} ariaLabel="Mars terrain map with regional dust disturbances on watch">
            {proj => (
              <g>
                <MapDefs />
                {data.watch.map(w => {
                  const [x, y] = proj.p(w.region.lat, w.region.lon);
                  const rKm = Math.sqrt(w.areaKm2 / Math.PI);
                  const r = Math.max(22, (rKm / kmPerDeg) * proj.s);
                  const on = w.code === sel;
                  return (
                    <g key={w.code} onClick={() => setSel(w.code)} style={{ cursor: 'pointer' }}>
                      <circle cx={x} cy={y} r={r * 1.9} fill="url(#dustcore)" opacity={0.65} />
                      <circle cx={x} cy={y} r={r} fill="#E7A94F" fillOpacity={on ? 0.32 : 0.2} stroke="#FFF1DD" strokeWidth={on ? 2 : 1.4} strokeDasharray="6 5" />
                      <MapText x={x} y={y - r - 10} anchor="middle" size={12}>{pct(w.probability)} chance</MapText>
                    </g>
                  );
                })}
                {data.colonies.map(col => <Pin key={col.slug} proj={proj} lat={col.lat} lon={col.lon} color={STATUS_COLOR[col.status]} labelColor={LABEL_COLOR[col.status]} label={short(col.name)} />)}
              </g>
            )}
          </MarsMap>
        </div>
      </section>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {data.watch.map(w => (
          <RingCard key={w.code} lift={w.code === sel} title={`Dust near ${w.origin}`} right={<Chip tone="warn">{pct(w.probability)} chance</Chip>}>
            <KV k="Could become a big storm in" v="2 weeks" />
            <KV k="Getting dustier" v={w.tauTrend >= 0.05 ? 'quickly' : 'slowly'} />
            <KV k="Size" v={`${int(w.areaKm2 / 1000)} thousand km²`} />
            <KV k="Nearest colony" v={data.colonies.find(c => c.slug === w.target)?.name ?? '—'} />
          </RingCard>
        ))}
        <div className="card"><div className="card-b" style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>These are dusty areas that might grow into a storm. If the chance goes above 70%, the Weather AI starts tracking it day by day.</div></div>
      </div>
    </div>
  );
}

/* ---------------- OUTLOOK ---------------- */
function Outlook({ data }: { data: F }) {
  const jd0 = data.clock.jd;
  const span = Math.ceil(Math.max(900, data.outlook.arrivalDay + 80));
  const series = useMemo(() => Array.from({ length: Math.floor(span / 4) + 1 }, (_, i) => { const d = i * 4, ls = marsLs(jd0 + d); return { d, ls, a: seasonActivity(ls) }; }), [jd0, span]);
  const W = 1040, Hh = 240, x0 = 44, x1 = W - 16, y0 = 24, y1 = 190;
  const x = (d: number) => x0 + (d / span) * (x1 - x0);
  const y = (a: number) => y1 - a * (y1 - y0 - 10);
  // dust-season bands and perihelion crossings
  const bands: [number, number][] = []; let start: number | null = null;
  series.forEach(p => { const inS = p.ls >= 160 && p.ls <= 340; if (inS && start === null) start = p.d; if (!inS && start !== null) { bands.push([start, p.d]); start = null; } });
  if (start !== null) bands.push([start, span]);
  const peri: number[] = []; series.forEach((p, i) => { if (i && series[i - 1].ls < 251 && p.ls >= 251) peri.push(p.d); });
  const line = series.map((p, i) => `${i ? 'L' : 'M'}${x(p.d).toFixed(1)} ${y(p.a).toFixed(1)}`).join(' ');
  const arr = data.outlook.arrivalDay, dep = data.outlook.departDay;
  const lsArr = marsLs(jd0 + arr);
  const yearOf = (d: number) => dateFromJd(jd0 + d).getUTCFullYear();
  return (
    <>
      <section className="card" aria-label="Season outlook">
        <div className="card-h"><h2>When are storms most likely?</h2><div className="r"><Chip tone="warn">A giant storm happens about 1 year in 5</Chip></div></div>
        <div className="card-b">
          <svg viewBox={`0 0 ${W} ${Hh}`} width="100%" role="img" aria-label={`How likely dust storms are over the next ${span} days. Earth supplies leave in ${Math.round(dep)} days and arrive in ${Math.round(arr)} days.`}>
            {bands.map(([a, b], i) => <g key={i}><rect x={x(a)} y={y0} width={x(b) - x(a)} height={y1 - y0} fill="#FEF3E2" /><text x={x(a) + 6} y={y1 - 8} style={{ font: '400 11px var(--font)' }} fill="#9A4A07">dust season</text></g>)}
            <g stroke="#EEF0F3">{[0, 0.5, 1].map(f => <path key={f} d={`M${x0} ${y(f)}H${x1}`} />)}</g>
            <path d={`${line} L${x(span)} ${y1} L${x0} ${y1}Z`} fill="#D97706" opacity=".14" />
            <path d={line} fill="none" stroke="#D97706" strokeWidth="2" />
            {peri.map(d => <g key={d}><line x1={x(d)} x2={x(d)} y1={y0} y2={y1} stroke="#9A4A07" strokeDasharray="3 4" /><text x={x(d) + 5} y={y0 + 12} style={{ font: '400 11px var(--font)' }} fill="#9A4A07">peak</text></g>)}
            <line x1={x(0)} x2={x(0)} y1={y0} y2={y1} stroke="#2F6FEB" strokeWidth="2" /><circle cx={x(0)} cy={y(series[0].a)} r={4} fill="#2F6FEB" />
            <text x={x(0) + 6} y={y0 + 12} style={{ font: '500 11px var(--font)' }} fill="#1F56C7">today</text>
            <line x1={x(dep)} x2={x(dep)} y1={y0} y2={y1} stroke="#0E1116" strokeDasharray="2 3" />
            <text x={x(dep) - 6} y={y0 + 62} textAnchor="end" style={{ font: '400 11px var(--font)' }} fill="#3A414B">rockets leave Earth · {yearOf(dep)}</text>
            <line x1={x(arr)} x2={x(arr)} y1={y0} y2={y1} stroke="#2F6FEB" strokeDasharray="4 3" strokeWidth="1.6" />
            <rect x={x(arr) - 4} y={y(seasonActivity(lsArr)) - 4} width="8" height="8" fill="#2F6FEB" transform={`rotate(45 ${x(arr)} ${y(seasonActivity(lsArr))})`} />
            <text x={x(arr) + (x(arr) > W - 200 ? -6 : 6)} y={y0 + 44} textAnchor={x(arr) > W - 200 ? 'end' : 'start'} style={{ font: '500 11px var(--font)' }} fill="#1F56C7">Earth supplies arrive</text>
            <g style={{ font: '400 10px var(--mono)' }} fill="#5B6370" textAnchor="middle">
              {Array.from({ length: Math.floor(span / 180) + 1 }, (_, i) => i * 180).map(d => <text key={'d' + d} x={x(d)} y={y1 + 32} fill="#8A919C">{d === 0 ? 'today' : `+${d} d`}</text>)}
            </g>
            <g style={{ font: '400 10px var(--mono)' }} fill="#8A919C" textAnchor="end"><text x={x0 - 6} y={y(1) + 4}>high</text><text x={x0 - 6} y={y(0) + 4}>low</text></g>
          </svg>
          <p className="faint" style={{ fontSize: 12, margin: '8px 0 0' }}>The orange line shows how likely storms are on each date, based on 14 years of Mars weather records. We order supplies from Earth early so they arrive in time.</p>
        </div>
      </section>
      <div className={st.charts}>
        <section className="card" aria-label="Colony season risk">
          <div className="card-h"><h2>Chance of a storm at each colony next season</h2></div>
          <div className="card-b" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {data.outlook.colonies.slice().sort((a, b) => b.risk - a.risk).map(c => (
              <div key={c.slug} style={{ display: 'grid', gridTemplateColumns: '140px 1fr 48px', alignItems: 'center', gap: 12, fontSize: 13 }}>
                <span>{c.name}</span>
                <div className="bar"><i style={{ width: `${c.risk * 100}%`, background: c.risk >= 0.65 ? 'var(--warn-dot)' : 'var(--viz-4)' }} /></div>
                <span className="num" style={{ textAlign: 'right' }}>{pct(c.risk)}</span>
              </div>
            ))}
          </div>
        </section>
        <section className="card" aria-label="What the outlook drives">
          <div className="card-h"><h2>What we do with this</h2></div>
          <div className="card-b" style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
            <div style={{ display: 'flex', gap: 10 }}><span className="tag t-order">1</span><span>We order extra supplies from Earth. Rockets leave {date(dateFromJd(jd0 + dep).toISOString())} and land {date(dateFromJd(jd0 + arr).toISOString())}.</span></div>
            <div style={{ display: 'flex', gap: 10 }}><span className="tag t-warn">2</span><span>During dust season, the Weather AI checks the dust every day.</span></div>
            <div style={{ display: 'flex', gap: 10 }}><span className="tag t-info">3</span><span>Rockets can only leave Earth every 26 months, so we have to plan far ahead.</span></div>
            <Link className="btn btn-sm" style={{ alignSelf: 'flex-start' }} href="/app/resupply">See the Earth order</Link>
          </div>
        </section>
      </div>
    </>
  );
}
