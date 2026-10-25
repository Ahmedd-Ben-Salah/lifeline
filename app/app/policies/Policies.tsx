'use client';
import { useEffect, useMemo, useState } from 'react';
import { useApi, useMe, post, useLive } from '@/lib/client/live';
import { useToast } from '@/lib/client/toast';
import { PageHead, Skeleton, ErrorCard, Chip, ProtocolTag } from '@/components/ui';
import { can } from '@/lib/auth/permissions';
import type { Policy } from '@/lib/server/types';
import type { MessageView } from '@/lib/server/views';
import s from './policies.module.css';

type P = { policy: Policy; history: { version: number; publishedBy: string; publishedMs: number; note?: string }[]; audit: { id: string; atMs: number; actor: string; action: string; target: string }[] };
const ACTIONS: { key: string; label: string; maxKey: 'max' | 'approvers' }[] = [
  { key: 'warn', label: 'Send a warning', maxKey: 'max' },
  { key: 'requestOffers', label: 'Ask others for help', maxKey: 'max' },
  { key: 'acceptOffer', label: 'Accept help', maxKey: 'max' },
  { key: 'dispatchRover', label: 'Send a rover', maxKey: 'max' },
  { key: 'changeRations', label: 'Change food and water rations', maxKey: 'max' },
  { key: 'earthOrder', label: 'Order from Earth', maxKey: 'approvers' },
];
const STATES = [{ k: 'normal', label: 'Normal' }, { k: 'delay', label: 'Slow link' }, { k: 'blackout', label: 'No link to Earth' }];
const NEXT: Record<string, string> = { AUTO: 'NOTIFY', NOTIFY: 'GO', GO: 'AUTO' };
const LABEL: Record<string, string> = { AUTO: 'AI does it', NOTIFY: 'AI does it, tells you', GO: 'Needs your OK' };
const CHARTER: { key: string; title: string; text: string }[] = [
  { key: 'equalBaseline', title: 'Everyone gets the same share', text: 'Food and water are shared equally in every town.' },
  { key: 'medicalFirst', title: 'Sick people come first', text: 'People who are ill always get full rations.' },
  { key: 'survivalMinimum', title: 'Nobody goes below the minimum', text: 'At least 2 kg of water a day, full air and a warm home.' },
  { key: 'agentsUseEngineNumbersOnly', title: 'The AI never makes up numbers', text: 'The AI can explain and agree on deals, but every number comes from our calculator.' },
  { key: 'volunteerPowerShifts', title: 'Volunteers can switch off power to save it', text: 'Off. The towns must vote first.' },
];
const SLIDERS: { key: keyof Policy['thresholds']; label: string; min: number; max: number; step: number; fmt: (v: number) => string; help: string }[] = [
  { key: 'stormProbability', label: 'Act on a storm when the chance is at least', min: 0.3, max: 0.95, step: 0.01, fmt: v => `${Math.round(v * 100)}%`, help: 'Out of 300 simulations, how many must hit a town.' },
  { key: 'replyTimeoutMin', label: 'Wait for an answer before helping anyway', min: 2, max: 120, step: 1, fmt: v => `${v} min`, help: 'If a town is silent this long, the others help it.' },
  { key: 'keepOwnReserveDays', label: 'A town that helps always keeps', min: 30, max: 180, step: 1, fmt: v => `${v} days`, help: 'Of its own supplies, so helping never puts it in danger.' },
  { key: 'criticalDays', label: 'Urgent when a town has less than', min: 7, max: 60, step: 1, fmt: v => `${v} days`, help: 'The town turns red.' },
  { key: 'watchDays', label: 'Watch when a town has less than', min: 14, max: 120, step: 1, fmt: v => `${v} days`, help: 'The town turns orange.' },
];
const APPROVERS = [
  { ini: 'AY', name: 'Ayari', role: 'Jezero', scope: 'Orders · rations' },
  { ini: 'LM', name: 'Lina M.', role: 'Utopia', scope: 'Orders' },
  { ini: 'EC', name: 'Earth control', role: 'Earth', scope: 'Orders' },
];

export default function Policies() {
  const { data, error, reload } = useApi<P>('/api/policies');
  const threads = useApi<{ threads: { id: string; messages: MessageView[] }[] }>('/api/threads');
  const me = useMe();
  const { bump } = useLive();
  const toast = useToast();
  const admin = can(me?.role, 'editPolicy');
  const [draft, setDraft] = useState<Policy | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [showAudit, setShowAudit] = useState(false);
  useEffect(() => { if (data && (!draft || draft.version !== data.policy.version)) setDraft(structuredClone(data.policy)); }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const changed = useMemo(() => !!(data && draft && JSON.stringify({ a: draft.autonomy, t: draft.thresholds, c: draft.charter }) !== JSON.stringify({ a: data.policy.autonomy, t: data.policy.thresholds, c: data.policy.charter })), [data, draft]);
  const decisions = useMemo(() => (threads.data?.threads ?? []).flatMap(t => t.messages).filter(m => ['TIMEOUT', 'ACCEPT'].includes(m.kind) || (m.kind === 'INFO' && m.author === 'human')).sort((a, b) => b.createdMs - a.createdMs).slice(0, 5), [threads.data]);

  if (error && !data) return <main className="page"><ErrorCard what="policies" onRetry={reload} /></main>;
  if (!data || !draft) return <main className="page"><Skeleton h={60} /><div className={s.po}><Skeleton h={420} /><Skeleton h={420} /></div></main>;
  const p = draft, orig = data.policy;

  function cycle(action: string, state: string) {
    if (!admin) return;
    setDraft(d => { const n = structuredClone(d!); n.autonomy[action][state] = NEXT[n.autonomy[action][state]] ?? 'AUTO'; return n; });
  }
  async function publish() {
    setBusy(true);
    try {
      const r = await post<Policy>('/api/policies', { autonomy: p.autonomy, thresholds: p.thresholds, charter: p.charter, note: note || undefined }, 'PUT');
      toast(`Saved. The AI follows the new rules now (version ${r.version}).`); setNote(''); bump(); reload();
    } catch (e) { toast((e as Error).message, true); } finally { setBusy(false); }
  }

  return (
    <main className="page">
      <PageHead title="Rules for the AI" sub={<>What the AI can do by itself, and what needs a person to say yes. <span className="faint">Version {orig.version} · by {orig.publishedBy}</span></>}
        actions={<>
          <button className="btn" onClick={() => setShowAudit(x => !x)}>{showAudit ? 'Hide history' : 'Show history'}</button>
          {admin ? <button className="btn btn-dark" disabled={!changed || busy} onClick={publish}>{busy ? 'Saving…' : 'Save rules'}</button> : <span className="chip chip-neutral">Only the admin can change these</span>}
        </>} />
      {admin && changed && (
        <div className="card fade-in" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px' }}>
          <span className="dot dot-sig" /><span style={{ fontSize: 13 }}>You changed something.</span>
          <input className="input" style={{ height: 32, flex: 1, maxWidth: 420 }} placeholder="Why? (optional)" value={note} onChange={e => setNote(e.target.value)} />
          <button className="btn btn-sm" onClick={() => setDraft(structuredClone(orig))}>Discard</button>
        </div>
      )}
      {showAudit && (
        <section className="card fade-in"><div className="card-h"><h2>Who changed the rules</h2></div>
          <table className="table"><thead><tr><th>When</th><th>Who</th><th>Version</th></tr></thead><tbody>
            {data.audit.length ? data.audit.map(a => <tr key={a.id}><td className="num">{new Date(a.atMs).toLocaleString()}</td><td>{a.actor}</td><td>{a.target.replace('v', 'version ')}</td></tr>) : <tr><td colSpan={3} className="muted">No changes yet.</td></tr>}
          </tbody></table>
        </section>
      )}
      <div className={s.po}>
        <div className={s.col}>
          <section className="card scroll-x" aria-label="What the AI may do">
            <div className="card-h"><h2>What the AI may do</h2><div className="r"><span className="faint" style={{ fontSize: 12 }}>{admin ? 'Click a box to change it' : 'Depends on how well we can reach Earth'}</span></div></div>
            <table className="table">
              <thead><tr><th>Action</th>{STATES.map(st => <th key={st.k}>{st.label}</th>)}</tr></thead>
              <tbody>
                {ACTIONS.map(a => (
                  <tr key={a.key}>
                    <td style={{ minWidth: 150, fontWeight: 500 }}>{a.label}</td>
                    {STATES.map(st => { const v = p.autonomy[a.key]?.[st.k] ?? 'GO'; const cls = v === 'AUTO' ? s.auto : v === 'NOTIFY' ? s.notify : s.go; const ch = v !== orig.autonomy[a.key]?.[st.k];
                      return <td key={st.k}>{admin ? <button className={`${s.lvl} ${cls} ${ch ? s.changed : ''}`} onClick={() => cycle(a.key, st.k)} title="Click to change">{LABEL[v]}</button> : <span className={`${s.lvl} ${cls}`}>{LABEL[v]}</span>}</td>; })}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section className="card" aria-label="Fairness charter">
            <div className="card-h"><h2>Fair-share promises</h2><Chip tone="ok">All 4 towns agreed</Chip></div>
            {CHARTER.map(c => (
              <label key={c.key} className={s.rule} style={{ cursor: admin ? 'pointer' : 'default' }}>
                <input type="checkbox" className="toggle" checked={!!p.charter[c.key]} disabled={!admin} onChange={e => setDraft(d => ({ ...d!, charter: { ...d!.charter, [c.key]: e.target.checked } }))} />
                <div className={s.t}>{c.title}<p>{c.text}</p></div>
              </label>
            ))}
          </section>
        </div>
        <div className={s.col}>
          <section className="card" aria-label="Thresholds">
            <div className="card-h"><h2>When to act</h2></div>
            {SLIDERS.map(sl => (
              <div key={sl.key} className={s.slider}>
                <div className={s.top}><label htmlFor={`sl-${sl.key}`}>{sl.label}</label><span className="mono" style={{ color: p.thresholds[sl.key] !== orig.thresholds[sl.key] ? 'var(--signal-ink)' : undefined }}>{sl.fmt(p.thresholds[sl.key])}</span></div>
                <input id={`sl-${sl.key}`} type="range" min={sl.min} max={sl.max} step={sl.step} value={p.thresholds[sl.key]} disabled={!admin} onChange={e => setDraft(d => ({ ...d!, thresholds: { ...d!.thresholds, [sl.key]: Number(e.target.value) } }))} />
                <p>{sl.help}</p>
              </div>
            ))}
          </section>
          <section className="card" aria-label="Approvers">
            <div className="card-h"><h2>Who can say yes</h2><div className="r"><span className="faint" style={{ fontSize: 12 }}>{orig.autonomy.earthOrder?.approvers ?? 2} people must approve an Earth order</span></div></div>
            {APPROVERS.map(a => <div key={a.ini} className={s.person}><span className="avatar">{a.ini}</span><div style={{ flex: 1 }}><div>{a.name}</div><div className="faint" style={{ fontSize: 12.5 }}>{a.role}</div></div><span className="pill-btn">{a.scope}</span></div>)}
            <div className="card-h" style={{ borderTop: '1px solid var(--line-2)' }}><h3>Latest decisions</h3></div>
            {decisions.length ? decisions.map(m => (
              <div key={m.id} className="stream-row"><span className="ts">{m.time}</span><span><ProtocolTag kind={m.kind === 'TIMEOUT' ? 'TIMEOUT' : m.kind} /></span><span>{m.body.length > 90 ? m.body.slice(0, 88) + '…' : m.body}</span></div>
            )) : <div className="stream-row"><span /><span /><span className="muted">No decisions yet.</span></div>}
          </section>
          <section className="card" aria-label="Version history">
            <div className="card-h"><h2>Earlier versions</h2></div>
            <div className={s.person}><span className="count-badge">v{orig.version}</span><div style={{ flex: 1 }}><div>Now · {orig.publishedBy}</div><div className="faint" style={{ fontSize: 12.5 }}>{orig.note || ''}</div></div><span className="faint mono" style={{ fontSize: 12 }}>{new Date(orig.publishedMs).toLocaleDateString()}</span></div>
            {data.history.map(h => <div key={h.version} className={s.person}><span className="count-badge zero">v{h.version}</span><div style={{ flex: 1 }}><div>{h.publishedBy}</div><div className="faint" style={{ fontSize: 12.5 }}>{h.note || ''}</div></div><span className="faint mono" style={{ fontSize: 12 }}>{new Date(h.publishedMs).toLocaleDateString()}</span></div>)}
          </section>
        </div>
      </div>
    </main>
  );
}
