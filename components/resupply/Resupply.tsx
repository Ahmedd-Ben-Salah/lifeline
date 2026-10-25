'use client';
/**
 * Earth order: when rockets can next leave Earth, what the three rockets carry, where they land,
 * and the two-person approval that has to travel to Earth at the speed of light.
 */
import { useMemo, useRef, useState } from 'react';
import { useApi, useLive, useMe, useNow, post } from '@/lib/client/live';
import { useToast } from '@/lib/client/toast';
import { Chip, ErrorCard, PageHead, Skeleton, DelayRing } from '@/components/ui';
import { mmss, int, minutes, fuelWord, landingWord, dustLevel, slopeWord } from '@/lib/client/format';
import { can } from '@/lib/auth/permissions';
import { findWindow } from '@/lib/engine/windows';
import { CATEGORY_LABEL, CATEGORY_ORDER, SHIP_CAPACITY_T } from '@/lib/engine/packer';
import type { resupply as ResupplyFn } from '@/lib/server/views';
import OrbitDiagram from './OrbitDiagram';
import Porkchop from './Porkchop';
import CargoShips, { CAT_COLOR } from './CargoShips';
import st from './resupply.module.css';

type R = ReturnType<typeof ResupplyFn>;
const jdDate = (jd: number) => new Date((jd - 2440587.5) * 86400000);
const fmtDate = (d: Date | string) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const pad = (n: number) => String(n).padStart(2, '0');

export default function Resupply() {
  const { data, error, reload } = useApi<R>('/api/resupply');
  const { state, bump } = useLive();
  const me = useMe();
  const now = useNow(1000);
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [fair, setFair] = useState(false);
  const [compare, setCompare] = useState(false);
  const approvalRef = useRef<HTMLElement>(null);

  const windows = useMemo(() => {
    if (!compare || !data) return null;
    const out = [];
    let jd = data.window.depJd - 30;
    for (let i = 0; i < 4; i++) { const w = findWindow(jd); out.push(w); jd = w.depJd + 120; }
    return out;
  }, [compare, data?.window.depJd]); // eslint-disable-line react-hooks/exhaustive-deps
  const nextAfter = useMemo(() => (data ? findWindow(data.window.depJd + 120) : null), [data?.window.depJd]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error && !data) return <main className="page"><ErrorCard what="resupply" onRetry={reload} /></main>;
  if (!data) return <main className="page"><Skeleton h={60} /><Skeleton h={320} /><div className={st.rs}><Skeleton h={380} /><Skeleton h={380} /></div></main>;

  // live sim clock → ticking countdown
  const jdNow = state ? state.clock.jd + (now - state.serverNow) / 86400000 : data.clock.jd;
  const left = Math.max(0, data.window.depJd - jdNow);
  const dd = Math.floor(left), hh = Math.floor((left - dd) * 24), mm = Math.floor(((left - dd) * 24 - hh) * 60), ss = Math.floor((((left - dd) * 24 - hh) * 60 - mm) * 60);
  const closes = left - 365;
  const order = data.order;
  const ships = order?.ships ?? data.plan.ships;
  const totalT = ships.reduce((a, s) => a + s.massT, 0);
  const cap = totalT / (ships.length * SHIP_CAPACITY_T);
  const byCat = CATEGORY_ORDER.map(c => ({ c, t: ships.reduce((a, s) => a + (s.byCategory[c] ?? 0), 0) })).filter(x => x.t > 0);
  const scale = data.scaledDelayMs / (data.lightDelaySec * 1000);
  const mine = order?.approvals.find(a => a.userEmail === me?.email);
  const canApprove = can(me?.role, 'approveOrder') && order?.status === 'AWAITING_APPROVAL' && !mine;
  const canConfirm = can(me?.role, 'fulfilOrder') && order?.status === 'SENT';
  const goCount = order?.approvals.filter(a => a.decision === 'GO').length ?? 0;

  async function act(kind: 'GO' | 'CHANGES' | 'CONFIRM') {
    if (!order) return;
    setBusy(kind);
    try {
      if (kind === 'CONFIRM') { await post(`/api/orders/${order.code}/confirm`); toast('Order confirmed. Factories can start.'); }
      else {
        const r = await post<{ arrivesInMs: number }>(`/api/orders/${order.code}/approve`, { decision: kind });
        toast(kind === 'CHANGES' ? 'Change request sent' : r.arrivesInMs > 0 ? `Approved · your OK reaches Earth in ${mmss(r.arrivesInMs)}` : 'Approved');
      }
      bump(); reload();
    } catch (e) { toast((e as Error).message, true); } finally { setBusy(null); }
  }

  const statusChip = !order ? <Chip tone="neutral">No order yet</Chip>
    : order.status === 'AWAITING_APPROVAL' ? <Chip tone="warn">{goCount ? `${goCount} of ${order.approvalsRequired} people approved` : `Needs ${order.approvalsRequired} people to approve`}</Chip>
      : order.status === 'SENT' ? <Chip tone="info">Sent to Earth</Chip>
        : order.status === 'CONFIRMED' ? <Chip tone="ok">Confirmed · being built</Chip> : <Chip tone="crit">Changes asked</Chip>;

  return (
    <main className="page">
      <PageHead title="Earth order" sub="Rockets can only fly from Earth to Mars about every 2 years. So we order what we need long before we need it."
        actions={<>
          <button className="btn" onClick={() => setCompare(true)}>Other launch dates</button>
          {canApprove && <button className="btn btn-dark" onClick={() => approvalRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>Approve order</button>}
        </>} />

      <section className={`card ${st.hero}`} aria-label="Next launch">
        <div className={st.heroL}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span className="eyebrow">Rockets can leave Earth in</span>
            <Chip tone={closes < 60 ? 'crit' : 'warn'}>{closes > 0 ? `Order by: ${int(closes)} days left` : 'Too late to order'}</Chip>
          </div>
          <div className={st.count} aria-live="off" aria-label={`${dd} days ${hh} hours ${mm} minutes until rockets can leave`}>
            <div className={st.u}><b>{dd}</b><span>days</span></div>
            <div className={st.u}><b>{pad(hh)}</b><span>hours</span></div>
            <div className={st.u}><b>{pad(mm)}</b><span>minutes</span></div>
            <div className={st.u}><b className={st.sec}>{pad(ss)}</b><span>seconds</span></div>
          </div>
          <div className={st.facts}>
            <div><div>Launch day</div><div>{fmtDate(data.window.depUtc)}</div></div>
            <div><div>Trip</div><div>{Math.round(data.window.tofDays)} days</div></div>
            <div><div>Fuel needed</div><div>{fuelWord(data.window.c3)}</div></div>
            <div><div>Lands on Mars</div><div>{fmtDate(data.window.arrUtc)}</div></div>
            <div><div>Message to Earth</div><div>{minutes(data.lightDelaySec)}</div></div>
            <div><div>If we miss it</div><div style={{ color: 'var(--crit)' }}>{nextAfter ? `wait ${Math.round((nextAfter.depJd - data.window.depJd) / 30.44)} more months` : '—'}</div></div>
          </div>
          <p className="faint" style={{ fontSize: 12, margin: 0 }}>We pick the day that needs the least fuel, using the real positions of Earth and Mars.</p>
        </div>
        <div className={st.heroR}>
          <OrbitDiagram o={data.orbits} tofDays={data.window.tofDays} depUtc={data.window.depUtc} arrUtc={data.window.arrUtc} />
        </div>
      </section>

      <div className={st.rs}>
        <section className="card" aria-label="Best launch dates">
          <div className="card-h"><h2>Best launch dates</h2><div className="r"><span className="faint" style={{ fontSize: 12 }}>Darker = less fuel. The circle is the best day.</span></div></div>
          <div className={st.pork}>
            <Porkchop d={data.porkchop as unknown as Parameters<typeof Porkchop>[0]['d']} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginTop: 8 }} className="muted">
              <span>Launch day →</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>less fuel<i style={{ width: 60, height: 8, borderRadius: 99, background: 'linear-gradient(90deg,#123A8C,#2F6FEB,#9DBCF7,#F1F3F5)' }} />more fuel</span>
              <span>↑ trip length</span>
            </div>
          </div>
        </section>

        <section className="card" aria-label="What the rockets carry">
          <div className="card-h"><h2>{ships.length} rockets · {int(totalT)} t of supplies</h2><div className="r">{data.plan.unplaced.length ? <Chip tone="crit">{data.plan.unplaced.length} items don&apos;t fit</Chip> : <Chip tone="ok">Everything fits · {Math.round(cap * 100)}% full</Chip>}</div></div>
          <div className="card-b" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <CargoShips ships={ships} />
            <div className={st.legend}>
              {byCat.map(x => <span key={x.c}><i className="dot" style={{ background: CAT_COLOR[x.c] }} />{CATEGORY_LABEL[x.c]} {int(x.t)} t</span>)}
            </div>
            <p className="faint" style={{ fontSize: 12, margin: 0 }}>Enough to cover what the towns can&apos;t make themselves until the next rockets, plus a little extra. Air is split over all rockets, so losing one rocket never loses all the air.</p>
          </div>
        </section>
      </div>

      <div className={st.rs}>
        <section className="card scroll-x" aria-label="Where to land">
          <div className="card-h"><h2>Where to land</h2><div className="r"><span className="faint" style={{ fontSize: 12 }}>flat, calm, close and not too dusty is best</span></div></div>
          <table className={`table ${st.zt}`}>
            <thead><tr><th>Spot</th><th>Ground</th><th>Quakes</th><th>To the town</th><th>Dust</th><th>Rating</th></tr></thead>
            <tbody>
              {data.zones.map((z, i) => (
                <tr key={z.name} style={i === 0 ? { background: 'var(--signal-tint)' } : undefined}>
                  <td style={{ fontWeight: i === 0 ? 600 : 400 }}>{z.name.replace('-', ' ')}</td>
                  <td>{slopeWord(z.slopeDeg)}</td>
                  <td><Chip tone={z.quakeRisk < 0.2 ? 'ok' : z.quakeRisk < 0.5 ? 'warn' : 'crit'} dot={false}>{z.quakeRisk < 0.2 ? 'Low' : z.quakeRisk < 0.5 ? 'Medium' : 'High'}</Chip></td>
                  <td className="num">{int(z.distanceKm)} km</td>
                  <td>{dustLevel(z.dustTau)}</td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className={st.parts} title="Blue: flat ground · Green: few quakes · Gold: close to the town · Purple: little dust">
                        <i style={{ width: `${z.parts.slope * 100}%`, background: '#2F6FEB' }} /><i style={{ width: `${z.parts.quake * 100}%`, background: '#0E9F8E' }} />
                        <i style={{ width: `${z.parts.distance * 100}%`, background: '#C28A12' }} /><i style={{ width: `${z.parts.dust * 100}%`, background: '#7357C9' }} />
                      </span>
                      <Chip tone={z.score >= 0.8 ? 'ok' : z.score >= 0.6 ? 'info' : 'warn'} dot={false}>{landingWord(z.score)}</Chip>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

        </section>

        <section className="card" aria-label="Approval" ref={approvalRef}>
          <div className="card-h"><h2>Approve the order</h2>{statusChip}</div>
          {order ? (
            <div className="card-b" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className={st.checks}>
                <label><input type="checkbox" checked readOnly /> Carries {Object.values(order.demand).reduce((a, b) => a + (b ?? 0), 0)} t: what the towns can&apos;t make, plus extra for storms</label>
                <label><input type="checkbox" checked readOnly /> Lands at the best spot: {order.landingZone.replace('-', ' ')}</label>
                <label><input type="checkbox" checked={fair} onChange={e => setFair(e.target.checked)} /> Supplies are shared fairly between the towns</label>
              </div>
              <div className={st.tl}>
                {order.approvals.map(a => (
                  <div key={a.userEmail} className={st.e}>
                    <span className="mono faint">{new Date(a.atMs).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
                    <span className={st.p} style={a.decision === 'CHANGES' ? { background: 'var(--crit-dot)' } : undefined} />
                    <span>
                      <b style={{ fontWeight: 600 }}>{a.name}</b> {a.decision === 'GO' ? 'approved' : 'asked for changes'} on {a.site === 'mars' ? 'Mars' : 'Earth'}{' '}
                      {a.site === 'mars' && (a.arrivesMs > now
                        ? <span className="delay" style={{ marginLeft: 4 }}><DelayRing startMs={a.atMs} endMs={a.arrivesMs} now={now} size={13} />reaches Earth in {mmss(a.arrivesMs - now)}</span>
                        : <span className="faint">· reached Earth</span>)}
                    </span>
                  </div>
                ))}
                {order.status === 'AWAITING_APPROVAL' && goCount >= order.approvalsRequired && (
                  <div className={`${st.e} ${st.f}`}><span className="mono faint">next</span><span className={st.p} /><span>The order is sent once both OKs reach Earth</span></div>
                )}
                {order.status === 'AWAITING_APPROVAL' && goCount < order.approvalsRequired && <>
                  <div className={`${st.e} ${goCount ? st.f : ''}`}><span className="mono faint">now</span><span className={st.p} /><span>{goCount ? 'A second person approves' : 'You approve'}</span></div>
                  <div className={`${st.e} ${st.f}`}><span className="mono faint">+{minutes(data.lightDelaySec)}</span><span className={st.p} /><span>Your OK reaches Earth</span></div>
                  <div className={`${st.e} ${st.f}`}><span className="mono faint">+{minutes(data.lightDelaySec * 2)}</span><span className={st.p} /><span>Earth&apos;s answer reaches Mars</span></div>
                </>}
                {(order.status === 'SENT' || order.status === 'CONFIRMED') && (
                  <div className={st.e}><span className="mono faint">{order.sentMs ? new Date(order.sentMs).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : ''}</span><span className={st.p} style={{ background: 'var(--ok-dot)' }} /><span>Sent to Earth · {order.status === 'CONFIRMED' ? 'confirmed, being built' : 'waiting for the supplier'}</span></div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                {canApprove && <button className="btn btn-dark" disabled={!!busy} onClick={() => act('GO')}>{busy === 'GO' ? 'Approving…' : 'Approve order'}</button>}
                {canApprove && <button className="btn" disabled={!!busy} onClick={() => act('CHANGES')}>Ask for changes</button>}
                {canConfirm && <button className="btn btn-signal" disabled={!!busy} onClick={() => act('CONFIRM')}>{busy === 'CONFIRM' ? 'Confirming…' : 'Confirm and start building'}</button>}
                {mine && order.status === 'AWAITING_APPROVAL' && <span className="faint" style={{ fontSize: 12.5 }}>You approved. A second person must approve too.</span>}
                {!can(me?.role, 'approveOrder') && order.status === 'AWAITING_APPROVAL' && <span className="faint" style={{ fontSize: 12.5 }}>You can look, but your role cannot approve.</span>}
              </div>
              <span className="faint" style={{ fontSize: 11.5 }}>{order.approvalsRequired} people must approve. Your OK takes {minutes(data.lightDelaySec)} to reach Earth (sped up ×{Math.round(1 / Math.max(0.01, scale))} for the demo).</span>
            </div>
          ) : <div className="card-b faint">No order yet. The Earth supply AI writes one when the towns need help from Earth.</div>}
        </section>
      </div>

      {compare && (
        <div className="modal-bg" onClick={() => setCompare(false)} role="dialog" aria-modal="true" aria-label="Other launch dates">
          <div className="modal fade-in" onClick={e => e.stopPropagation()} style={{ width: 'min(620px,100%)' }}>
            <div className="card-h"><h2>Next launch dates</h2><div className="r"><button className="btn btn-sm" onClick={() => setCompare(false)}>Close</button></div></div>
            <div className={st.winRow} style={{ color: 'var(--ink-4)', fontSize: 12 }}><span>Launch</span><span>Fuel</span><span>Trip</span><span>Lands</span></div>
            {windows ? windows.map((w, i) => (
              <div key={w.depJd} className={st.winRow} style={i === 0 ? { background: 'var(--signal-tint)' } : undefined}>
                <span className="mono">{fmtDate(jdDate(w.depJd))}{i === 0 && <span className="faint"> · our order</span>}</span>
                <span>{fuelWord(w.c3)}</span><span className="mono">{Math.round(w.tofDays)} days</span><span className="mono">{fmtDate(jdDate(w.arrJd))}</span>
              </div>
            )) : <div style={{ padding: 16 }}><Skeleton h={120} /></div>}
            <div className="faint" style={{ fontSize: 12, padding: '10px 16px' }}>Earth and Mars line up about every 26 months. Some years need more fuel because Mars&apos; path is not a perfect circle.</div>
          </div>
        </div>
      )}
    </main>
  );
}
