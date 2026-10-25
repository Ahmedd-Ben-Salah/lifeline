'use client';
import { useMemo } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useApi } from '@/lib/client/live';
import { Kpi, RingCard, KV, StatusChip, Seg, Skeleton, ErrorCard, Chip } from '@/components/ui';
import ForecastChart from '@/components/colony/ForecastChart';
import EquipmentIcon from '@/components/colony/EquipmentIcon';
import { int, pct, RES_LABEL, dustLevel } from '@/lib/client/format';
import { marsSubsolar } from '@/lib/engine/ephemeris';
import { lmst } from '@/lib/sim';
import type { colonyDetail } from '@/lib/server/views';
import s from '../colony.module.css';

const MarsGlobe = dynamic(() => import('@/components/globe/MarsGlobe'), { ssr: false });
type C = NonNullable<ReturnType<typeof colonyDetail>>;
type Pol = { policy: { thresholds: { criticalDays: number; watchDays: number; keepOwnReserveDays: number }; charter: Record<string, boolean> } };
const COLOR: Record<string, string> = { CRITICAL: '#DC2626', WATCH: '#D97706', NOMINAL: '#16A34A' };
const RES = ['O2', 'WATER', 'FOOD'] as const;
const NEED: Record<string, number> = { O2: 0.84, WATER: 6.5, FOOD: 1.8 };
const EQ_NAME: Record<string, string> = { solar: 'Solar panels', fission: 'Nuclear power', wrs: 'Water recycling', oga: 'Air maker', comms: 'Radio', ice: 'Ice mine' };

export default function ColonyDetail() {
  const { id } = useParams<{ id: string }>();
  const sp = useSearchParams();
  const router = useRouter();
  const resource = (RES as readonly string[]).includes((sp.get('resource') || '').toUpperCase()) ? (sp.get('resource') as string).toUpperCase() : 'O2';
  const { data, error, reload } = useApi<C>(`/api/colonies/${id}?resource=${resource}`);
  const pol = useApi<Pol>('/api/policies');
  const sub = useMemo(() => (data ? marsSubsolar(data.clock.jd) : null), [data?.clock.sol]); // eslint-disable-line react-hooks/exhaustive-deps
  const pins = useMemo(() => data ? data.all.length ? [{ id: data.colony.slug, lat: data.colony.lat, lon: data.colony.lon, color: COLOR[data.colony.status], label: data.colony.name, pulse: data.colony.status === 'CRITICAL' }] : [] : [], [data]);

  if (error && !data) return <main className="page"><ErrorCard what="this colony" onRetry={reload} /></main>;
  if (!data) return <main className="page"><Skeleton h={60} /><Skeleton h={300} /><div className="kpis">{[0, 1, 2, 3].map(i => <Skeleton key={i} h={86} />)}</div><Skeleton h={340} /></main>;

  const c = data.colony;
  const th = pol.data?.policy.thresholds ?? { criticalDays: 30, watchDays: 60, keepOwnReserveDays: 90 };
  const st = c.stocks.find(x => x.resource === resource)!;
  const color = (status: string) => (status === 'CRITICAL' ? 'var(--crit)' : status === 'WATCH' ? 'var(--warn)' : undefined);
  const lat = `${Math.abs(c.lat).toFixed(1)}°${c.lat >= 0 ? 'N' : 'S'} ${(((c.lon % 360) + 360) % 360).toFixed(1)}°E`;
  const imp = data.storm?.impact;
  const pw = c.power;
  const solarNow = pw.availableKw - pw.nuclearKw;
  const setRes = (r: string) => router.replace(`/app/colonies/${id}?resource=${r}`, { scroll: false });
  const charter = pol.data?.policy.charter;

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}><h1>{c.name}</h1><StatusChip status={c.status} /></div>
          <div className="sub">{c.population} people live here. {RES_LABEL[c.lowest.resource]} runs low first: {int(c.lowest.days)} days left.{c.agentOnline ? '' : ' Its radio is broken by the dust, so it cannot answer.'}</div>
        </div>
        <div className="actions">
          <select className="select" aria-label="Switch colony" value={c.slug} onChange={e => router.push(`/app/colonies/${e.target.value}?resource=${resource}`)}>{data.all.map(x => <option key={x.slug} value={x.slug}>{x.name}</option>)}</select>
          <Link className="btn" href="/app/comms">See the AI chat</Link>
          <Link className="btn btn-dark" href="/app/logistics">Send a rover</Link>
        </div>
      </div>

      <section className={s.hero} aria-label={`${c.name} on Mars`}>
        <MarsGlobe pins={pins} subsolar={sub} focus={{ lat: c.lat, lon: c.lon }} zoom={0.95} hiRes autoRotate={false} />
        <div className={s.heroTop}><span className="pill-btn">Time here <span className="mono" style={{ color: 'var(--ink)' }}>{lmst(data.clock.jd, c.lon)}</span>{(() => { const h = +lmst(data.clock.jd, c.lon).slice(0, 2); return h < 6 || h >= 18 ? ' · night' : ' · day'; })()}</span><span className="pill-btn">Dust: {dustLevel(pw.localTau)}</span></div>
        <RingCard className={s.heroInfo} title="Right now" right={<Chip tone={c.agentOnline ? 'ok' : 'crit'}>{c.agentOnline ? 'AI online' : 'Not answering'}</Chip>}>
          <KV k="People" v={`${c.population}`} />
          <KV k="Dust in the air" v={dustLevel(pw.localTau)} />
          <KV k="Power" v={`${pct(c.powerPct)} of what it needs`} />
        </RingCard>
      </section>

      <div className="kpis">
        {RES.map(r => { const x = c.stocks.find(y => y.resource === r)!; return (
          <button key={r} className="kpi" onClick={() => setRes(r)} style={{ textAlign: 'left', cursor: 'pointer', borderColor: r === resource ? 'var(--signal)' : undefined, boxShadow: r === resource ? '0 0 0 3px var(--signal-ring)' : undefined }} aria-pressed={r === resource}>
            <div style={{ flex: 1 }}><div className="l">{RES_LABEL[r]} left</div><div className="n" style={{ color: color(x.status) }}>{int(x.days)}<small> days</small></div><div className="faint" style={{ fontSize: 11.5, marginTop: 4 }}>{int(x.amount)} kg stored · each person needs {NEED[r]} kg a day</div></div>
          </button>
        ); })}
        <Kpi label="Power" value={pct(c.powerPct)} unit="of what it needs"  color={c.powerPct < 0.6 ? 'var(--crit)' : c.powerPct < 0.95 ? 'var(--warn)' : undefined} />
      </div>

      <div className={s.co}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          <section className="card" aria-label={`${RES_LABEL[resource]} forecast`}>
            <div className="card-h"><h2>{RES_LABEL[resource]}: what happens next (60 days)</h2><div className="r"><Seg label="Resource" value={resource} onChange={setRes} options={RES.map(r => ({ value: r, label: RES_LABEL[r] }))} /></div></div>
            <div className="card-b">
              {data.forecast ? <ForecastChart f={data.forecast} dailyUse={st.dailyUse} reserveDays={th.criticalDays} colonyName={c.name} resourceLabel={RES_LABEL[resource]} /> : <Skeleton h={260} />}
              <div className="faint" style={{ fontSize: 12, marginTop: 10 }}>We ran this 300 times with different storms. When the storm blocks the sun, there is less power, so the colony makes less {RES_LABEL[resource].toLowerCase()}.</div>
            </div>
          </section>

          <div className={s.grid2}>
            <section className="card" aria-label="Power">
              <div className="card-h"><h2>Power</h2><div className="r"><span className="faint" style={{ fontSize: 12 }}>{pct(c.powerPct)} of what it needs</span></div></div>
              <div className="card-b" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div className={s.powerBar} role="img" aria-label={`Fission ${int(pw.nuclearKw)} kW, solar ${int(solarNow)} kW, demand ${int(pw.demandKw)} kW`}>
                  <i style={{ width: `${(pw.nuclearKw / pw.demandKw) * 100}%`, background: '#7357C9' }} />
                  <i style={{ width: `${Math.min(100 - (pw.nuclearKw / pw.demandKw) * 100, (solarNow / pw.demandKw) * 100)}%`, background: '#C28A12' }} />
                </div>
                <KV k={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span className="dot" style={{ background: '#7357C9' }} />Nuclear (always on)</span>} v={`${int(pw.nuclearKw)} kW`} />
                <KV k={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span className="dot" style={{ background: '#C28A12' }} />Solar (dust blocks it)</span>} v={`${int(solarNow)} kW`} />
                <KV k="Needed" v={`${int(pw.demandKw)} kW`} />
                <KV k="Missing" v={`${int(Math.max(0, pw.demandKw - pw.availableKw))} kW`} vStyle={{ color: pw.demandKw > pw.availableKw ? 'var(--crit)' : undefined }} />
              </div>
            </section>
            <section className="card" aria-label="Storm impact">
              <div className="card-h"><h2>Dust storm</h2><div className="r">{data.storm && imp ? <Chip tone={imp.probability >= 0.7 ? 'crit' : imp.probability >= 0.3 ? 'warn' : 'ok'}>{Math.round(imp.probability * 100)}% chance</Chip> : <Chip tone="ok">No storm</Chip>}</div></div>
              <div className="card-b" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {data.storm && imp ? <>
                  <KV k="Arrives in" v={imp.arrivalP10 === null ? 'probably misses' : `${Math.max(0, Math.round(imp.arrivalP10))}–${Math.max(0, Math.round(imp.arrivalP90 ?? 0))} days`} />
                  <KV k="Dust level" v={imp.tauP10 === null ? '—' : dustLevel(imp.tauP90)} />
                  <KV k="Solar power drops" v={data.storm.solarLossMax === null ? '—' : pct(data.storm.solarLossMax)} />
                  <Link href="/app/forecasts" style={{ fontSize: 12.5 }}>See the storm forecast →</Link>
                </> : <span className="muted" style={{ fontSize: 13 }}>No storm is coming here.</span>}
              </div>
            </section>
          </div>
        </div>

        <div className={s.side}>
          <RingCard lift title="Help on the way" right={<span className="count-badge">{data.incoming.length}</span>}
            sect={charter && <div className="sect"><span className="k">Our promise</span><span style={{ fontSize: 12.5 }}>{[charter.equalBaseline && `Everyone gets the same share.`, charter.medicalFirst && 'Sick people come first.', charter.survivalMinimum && 'Nobody gets less than they need to stay alive.'].filter(Boolean).join(' ')}</span></div>}>
            {data.incoming.length ? data.incoming.map(t => (
              <div key={t.code} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <KV k={`${t.rover ? `Rover ${t.rover.replace('r-', '')}` : 'Rover'} from ${t.from[0].toUpperCase()}${t.from.slice(1)}`} v={t.status === 'LOADING' ? 'loading' : `in ${Math.round(t.etaSols)} days`} />
                <span className="faint" style={{ fontSize: 12 }}>{Object.entries(t.cargo).map(([k, v]) => `${int(v)} kg ${k === 'O2' ? 'air' : k.toLowerCase()}`).join(' · ')}</span>
              </div>
            )) : <span className="muted" style={{ fontSize: 13 }}>No rovers coming yet.</span>}
            <KV k="Supplies from Earth" v={<Link href="/app/resupply">see order</Link>} />
          </RingCard>
          <section className="card" aria-label="Equipment">
            <div className="card-h"><h2>Equipment</h2><div className="r"><span className="count-badge zero">{c.equipment.length}</span></div></div>
            {c.equipment.map(e => (
              <div key={e.name} className={s.eq}>
                <EquipmentIcon kind={e.kind} />
                <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 500 }}>{EQ_NAME[e.kind] ?? e.name}</div></div>
                <Chip tone={e.status === 'DOWN' ? 'crit' : e.status === 'WATCH' ? 'warn' : 'ok'}>{e.status === 'DOWN' ? 'Broken' : e.status === 'WATCH' ? `Weak · ${e.healthPct}%` : 'Working'}</Chip>
              </div>
            ))}
          </section>
        </div>
      </div>
    </main>
  );
}

