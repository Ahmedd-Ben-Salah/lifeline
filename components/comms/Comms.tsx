'use client';
/**
 * Comms — the team chat between the colony AIs, Earth and people.
 * Messages to and from Earth travel at the speed of light, so they show a small countdown.
 *
 * Questions you ask are shown right away from the server's reply (not only after the next refresh),
 * so the chat keeps working even when serverless instances don't share memory.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useApi, useLive, useMe, useNow, post } from '@/lib/client/live';
import { useToast } from '@/lib/client/toast';
import { AgentAvatar, DelayRing, ProtocolTag, RingCard, KV, Skeleton, ErrorCard, Seg, agentName } from '@/components/ui';
import { mmss, minutes } from '@/lib/client/format';
import { can } from '@/lib/auth/permissions';
import type { threadView, MessageView } from '@/lib/server/views';
import s from './comms.module.css';

type ThreadV = ReturnType<typeof threadView>;
interface Payload {
  threads: ThreadV[]; serverNow: number; lightDelaySec: number;
  agents: Record<string, { state: 'online' | 'silent' | 'delay'; label: string }>;
  orders: { code: string; status: string; approvalsRequired: number; approvedBy: string[] }[];
}
interface Mine { key: string; threadId: string; q: string; at: number; status: 'pending' | 'done' | 'error'; error?: string; question?: MessageView; answer?: MessageView }

const SUGGESTIONS = ['What if the storm lasts 60 days?', 'When can rockets leave Earth?', 'Where is Rover 7?'];

const THREAD_ICON: Record<string, [string, string, string]> = {
  'storm-s17': ['!', '#FDECEC', '#B91C1C'],
  'watch-w04': ['VA', '#FEF3E2', '#9A4A07'],
  'earth-channel': ['EA', '#E8F0FA', '#3A6EA5'],
};

/** What each engine tool did, in plain words. */
const TOOL_WORDS: Record<string, string> = {
  storm_ensemble: 'checked the storm forecast', resource_forecast: 'checked supplies', rover_route: 'planned a route',
  launch_window: 'checked launch dates', cargo_plan: 'packed the rockets', landing_zones: 'picked a landing spot',
  network_status: 'checked all towns', fleet_status: 'checked the rovers', light_delay: 'checked the Earth link',
  season_outlook: 'checked the season', watch_model: 'checked the dust',
};
const toolWords = (n: string) => TOOL_WORDS[n] ?? 'used a calculator';

const LINK_WORDS: Record<string, (v: string) => string> = {
  storm: () => 'Dust storm', transfer: v => `Delivery #${v.replace('TR-0', '')}`, order: v => `Earth order #${v.replace('ORD-0', '')}`, window: v => `Rockets leave ${v}`, earth: () => 'Earth link',
};
const LINK_HREF: Record<string, string> = { storm: '/app/forecasts', transfer: '/app/logistics', order: '/app/resupply', window: '/app/resupply' };

export default function Comms({ threadId }: { threadId?: string }) {
  const { data, error, reload } = useApi<Payload>('/api/threads');
  const { state, bump } = useLive();
  const me = useMe();
  const now = useNow(500);
  const toast = useToast();
  const router = useRouter();
  const sp = useSearchParams();
  const [filter, setFilter] = useState<'all' | 'needs' | 'earth'>('all');
  const [q, setQ] = useState('');
  const [text, setText] = useState('');
  const [mine, setMine] = useState<Mine[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { const a = sp.get('ask'); if (a) { setText(a); setTimeout(() => inputRef.current?.focus(), 50); } }, [sp]);

  const threads = useMemo(() => {
    if (!data) return [];
    return data.threads.filter(t => {
      if (filter === 'needs' && t.status !== 'NEEDS_YOU') return false;
      if (filter === 'earth' && !t.earth && !t.messages.some(m => m.crossesLink)) return false;
      if (q && !(t.title + ' ' + t.messages.map(m => m.body).join(' ')).toLowerCase().includes(q.toLowerCase())) return false;
      return true;
    });
  }, [data, filter, q]);
  const current = data?.threads.find(t => t.id === threadId) ?? data?.threads[0];

  // server messages + my recent questions/answers that the server copy doesn't show (yet)
  const shown = useMemo(() => {
    if (!current) return [] as MessageView[];
    const ids = new Set(current.messages.map(m => m.id));
    const extra: MessageView[] = [];
    for (const x of mine) {
      if (x.threadId !== current.id) continue;
      if (x.question && !ids.has(x.question.id)) extra.push(x.question);
      if (x.answer && !ids.has(x.answer.id)) extra.push(x.answer);
    }
    return [...current.messages, ...extra].sort((a, b) => a.createdMs - b.createdMs);
  }, [current, mine]);
  const pendingHere = mine.filter(x => current && x.threadId === current.id && x.status !== 'done');
  const busy = mine.some(x => x.status === 'pending');

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [current?.id, shown.length, pendingHere.length]);

  if (error && !data) return <main className="page"><ErrorCard what="the chat" onRetry={reload} /></main>;
  if (!data || !current) return <div className={s.cm}><div className={s.threads}><Skeleton h={400} style={{ margin: 14 }} /></div><div className={s.convo}><Skeleton h={500} style={{ margin: 20 }} /></div></div>;

  const canAsk = can(me?.role, 'ask');
  const order = data.orders.find(o => o.code === current.linked.order);
  const answerer = me?.site === 'earth' ? 'earth-supply-agent' : 'jezero-agent';

  async function ask(question: string, retryKey?: string) {
    const qq = question.trim();
    if (!qq || !current) return;
    setText('');
    const key = retryKey ?? `q${Date.now()}`;
    const tid = current.id;
    setMine(list => [...list.filter(x => x.key !== key), { key, threadId: tid, q: qq, at: Date.now(), status: 'pending' }]);
    try {
      const r = await post<{ question: MessageView; answer: MessageView }>(`/api/threads/${tid}/ask`, { question: qq });
      setMine(list => list.map(x => (x.key === key ? { ...x, status: 'done', question: r.question, answer: r.answer } : x)));
      bump(); reload();
    } catch (e) {
      setMine(list => list.map(x => (x.key === key ? { ...x, status: 'error', error: (e as Error).message } : x)));
    }
  }
  async function accept(m: MessageView) {
    setBusyId(m.id);
    try { await post(`/api/offers/${m.id}/accept`); toast('Offer accepted'); bump(); }
    catch (e) { toast((e as Error).message, true); } finally { setBusyId(null); }
  }
  async function approve(code: string) {
    setBusyId(code);
    try { const r = await post<{ arrivesInMs: number }>(`/api/orders/${code}/approve`, { decision: 'GO' }); toast(r.arrivesInMs > 0 ? `Approved · your OK reaches Earth in ${mmss(r.arrivesInMs)}` : 'Approved'); bump(); }
    catch (e) { toast((e as Error).message, true); } finally { setBusyId(null); }
  }

  const icon = (id: string, title: string) => THREAD_ICON[id] ?? [title.slice(0, 2).toUpperCase(), '#F1F3F5', '#3A414B'];
  const preview = (t: ThreadV) => {
    const l = t.last;
    if (!l) return 'No messages yet';
    return `${agentName(l.from)}: ${l.body}`;
  };
  const storm = current.linked.storm;
  const headChip = storm === 'S-17' ? <span className="chip chip-crit"><span className="d" />Storm coming</span> : storm ? <span className="chip chip-warn"><span className="d" />Watching</span> : current.earth ? <span className="chip chip-info">Earth is {minutes(data.lightDelaySec)} away</span> : null;
  const [ic0, ic1, ic2] = icon(current.id, current.title);

  return (
    <div className={s.cm}>
      <aside className={s.threads} aria-label="Conversations">
        <div className={s.threadsTop}>
          <input className={s.searchBox} placeholder="Search" value={q} onChange={e => setQ(e.target.value)} aria-label="Search conversations" />
          <Seg label="Filter" value={filter} onChange={setFilter} options={[{ value: 'all', label: 'All' }, { value: 'needs', label: 'Needs you' }, { value: 'earth', label: 'Earth' }]} />
        </div>
        <div className={s.list}>
          {threads.map(t => {
            const [a, bg, fg] = icon(t.id, t.title);
            const transit = t.messages.find(m => m.crossesLink && m.deliverMs > now);
            return (
              <Link key={t.id} href={`/app/comms/${t.id}`} className={s.thread} aria-current={t.id === current.id} scroll={false}>
                <span className={s.ic} style={{ background: bg, color: fg }}>{a}</span>
                <span className={s.t}>
                  <b>{t.title}<span>{transit ? <><DelayRing startMs={transit.createdMs} endMs={transit.deliverMs} now={now} size={12} />{mmss(transit.deliverMs - now)}</> : t.last?.time}</span></b>
                  <p>{t.status === 'NEEDS_YOU' && <span style={{ color: 'var(--signal-ink)', fontWeight: 500 }}>Needs you · </span>}{preview(t)}</p>
                </span>
              </Link>
            );
          })}
          {!threads.length && <div className={s.empty}>Nothing found.</div>}
        </div>
      </aside>

      <section className={s.convo} aria-label={current.title}>
        <div className={s.convoH}>
          <span className={s.ic} style={{ background: ic1, color: ic2 }}>{ic0}</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 14.5 }}>{current.title}</div>
            <div className="faint" style={{ fontSize: 12.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{current.participants.filter(p => !p.startsWith('ops:')).map(agentName).join(' · ')}</div>
          </div>
          <span style={{ marginLeft: 'auto' }}>{headChip}</span>
        </div>

        <div className={s.convoB} ref={scroller} aria-live="polite">
          <div className={s.day}><span>Mars day {state?.clock.sol.toLocaleString('en-US') ?? '—'}</span></div>
          {shown.map(m => (
            <Message key={m.id} m={m} now={now} agents={data.agents}
              order={m.kind === 'ORDER' ? order : undefined}
              canAccept={can(me?.role, 'acceptOffer')} canApprove={!!order && can(me?.role, 'approveOrder') && order.status === 'AWAITING_APPROVAL' && !order.approvedBy.includes(me?.email ?? '')}
              busy={busyId} onAccept={accept} onApprove={approve} onRules={() => router.push('/app/policies')} />
          ))}
          {pendingHere.map(x => (
            <div key={x.key}>
              <div className={`${s.msg} fade-in`}>
                <AgentAvatar id={`ops:${me?.name ?? 'me'}`} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className={s.meta}><b>{me?.name}</b><ProtocolTag kind="ASK" /><span className={s.time}>{x.status === 'pending' ? 'sent' : 'not sent'}</span></div>
                  <div className={s.body}>{x.q}</div>
                </div>
              </div>
              {x.status === 'pending' && (
                <div className={`${s.working} fade-in`}>
                  <AgentAvatar id={answerer} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div className={s.meta}><b>{agentName(answerer)}</b><span className="faint" style={{ fontSize: 12.5 }}>is thinking and checking the numbers ({Math.max(1, Math.round((Date.now() - x.at) / 1000))} s)</span><span className={s.dots}><i /><i /><i /></span></div>
                    <div style={{ display: 'flex', gap: 6 }}><span className={`skel ${s.ghostChip}`} /><span className={`skel ${s.ghostChip}`} style={{ width: 120 }} /></div>
                  </div>
                </div>
              )}
              {x.status === 'error' && (
                <div className={`${s.msg} fade-in`} role="alert">
                  <AgentAvatar id="system" />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className={s.meta}><b>No answer</b></div>
                    <div className={s.body} style={{ color: 'var(--crit)' }}>The answer did not arrive{x.error ? ` (${x.error})` : ''}.</div>
                    <div className={s.actions}>
                      <button className="btn btn-sm btn-dark" disabled={busy} onClick={() => ask(x.q, x.key)}>Try again</button>
                      <button className="btn btn-sm" onClick={() => setMine(l => l.filter(y => y.key !== x.key))}>Dismiss</button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className={s.composer}>
          <div className={s.sugg}>
            {SUGGESTIONS.map(x => <button key={x} type="button" disabled={!canAsk || busy} onClick={() => ask(x)}>{x}</button>)}
          </div>
          <form className={s.box} onSubmit={e => { e.preventDefault(); ask(text); }}>
            <input ref={inputRef} value={text} onChange={e => setText(e.target.value)} disabled={!canAsk || busy}
              placeholder={canAsk ? 'Ask the AI a question…' : 'You can read this chat, but your role cannot ask questions'} aria-label="Ask the AI" />
            <button className="btn btn-signal btn-sm" type="submit" disabled={!canAsk || !text.trim() || busy}>{busy ? 'Thinking…' : 'Ask'}</button>
          </form>
        </div>
      </section>

      <aside className={s.ctx} aria-label="About this chat">
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Who is in this chat</div>
          {current.participants.filter(p => !p.startsWith('ops:')).map(p => {
            let st = data.agents[p] ?? { state: 'online' as const, label: 'online' };
            // seen from Earth, Earth is local and Mars is minutes away
            if (me?.site === 'earth') st = st.state === 'delay' ? { state: 'online', label: 'online' } : st.state === 'online' ? { state: 'delay', label: 'far away' } : st;
            const label = st.state === 'silent' ? 'not answering' : st.state === 'delay' ? `${minutes(data.lightDelaySec)} away` : 'online';
            return (
              <div key={p} className={s.part}>
                <span className={`dot ${st.state === 'silent' ? 'dot-crit' : st.state === 'delay' ? 'dot-warn' : 'dot-ok'}`} />
                <span>{agentName(p)}</span>
                <span style={st.state === 'silent' ? { color: 'var(--crit)' } : undefined}>{label}</span>
              </div>
            );
          })}
        </div>
        {Object.keys(current.linked).length > 0 && (
          <RingCard title="Related">
            {Object.entries(current.linked).map(([k, v]) => {
              const label = LINK_WORDS[k]?.(v) ?? v;
              const href = LINK_HREF[k];
              return <KV key={k} k={label} v={href ? <Link href={href}>Open</Link> : `${minutes(data.lightDelaySec)} away`} />;
            })}
          </RingCard>
        )}
        <section className="card">
          <div className="card-h"><h2>Safety rules</h2></div>
          <ul className={s.guard}>
            <li>The AI only uses numbers from our calculator.</li>
            <li>Big decisions need a person to say yes.</li>
            <li>If a town stops answering, the others help it.</li>
          </ul>
        </section>
      </aside>
    </div>
  );
}

function Message({ m, now, agents, order, canAccept, canApprove, busy, onAccept, onApprove, onRules }: {
  m: MessageView; now: number; agents: Payload['agents'];
  order?: Payload['orders'][number]; canAccept: boolean; canApprove: boolean; busy: string | null;
  onAccept: (m: MessageView) => void; onApprove: (code: string) => void; onRules: () => void;
}) {
  const inTransit = m.crossesLink && m.deliverMs > now;
  const fromSilent = agents[m.from]?.state === 'silent';
  const authorCls = m.author === 'llm' ? s.aLlm : m.author === 'human' ? s.aHuman : s.aScripted;
  const authorText = m.author === 'llm' ? 'written by Claude' : m.author === 'human' ? 'person' : 'auto';
  const toEarth = m.to === 'earth-control' || m.to === 'supplier';
  const tools = [...new Set(m.tools.map(t => toolWords(t.name)))];
  return (
    <div className={`${s.msg} fade-in`}>
      <AgentAvatar id={m.from} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className={s.meta}>
          <b style={fromSilent ? { color: 'var(--crit)' } : undefined}>{agentName(m.from)}</b>
          {m.to && <span className={s.arrow}>→ {agentName(m.to)}</span>}
          <ProtocolTag kind={m.kind} />
          <span className={s.time}>{m.time}</span>
          {inTransit && <span className={s.transit}><DelayRing startMs={m.createdMs} endMs={m.deliverMs} now={now} size={12} />on its way to {toEarth ? 'Earth' : 'Mars'} · {mmss(m.deliverMs - now)}</span>}
          {m.crossesLink && !inTransit && <span className="faint" style={{ fontSize: 11.5 }}>· reached {toEarth ? 'Earth' : 'Mars'}</span>}
        </div>
        <div className={`${s.body}${inTransit ? ' ' + s.bodyTransit : ''}`}>
          {m.body}
          {m.kind === 'TIMEOUT' && <> <a href="/app/policies" onClick={e => { e.preventDefault(); onRules(); }}>See the rules</a></>}
        </div>
        {m.payload.length > 0 && (
          <div className={s.payload}>
            {m.payload.map(([k, v]) => <div key={k} className={s.prow}><span>{k}</span><span>{v}</span></div>)}
          </div>
        )}
        {m.kind === 'OFFER' && (
          <div className={s.actions}>
            {m.accepted ? <span className="chip chip-ok"><span className="d" />Accepted</span>
              : canAccept ? <button className="btn btn-sm btn-dark" disabled={busy === m.id} onClick={() => onAccept(m)}>{busy === m.id ? 'Accepting…' : 'Accept offer'}</button> : null}
          </div>
        )}
        {m.kind === 'ORDER' && (
          <div className={s.actions}>
            {order?.status === 'AWAITING_APPROVAL' && canApprove && <button className="btn btn-sm btn-dark" disabled={busy === order.code} onClick={() => onApprove(order.code)}>{busy === order.code ? 'Approving…' : 'Approve order'}</button>}
            {order && <span className={`chip ${order.status === 'AWAITING_APPROVAL' ? 'chip-warn' : 'chip-ok'}`}><span className="d" />{order.status === 'AWAITING_APPROVAL' ? `${order.approvedBy.length} of ${order.approvalsRequired} people approved` : order.status === 'SENT' ? 'sent' : 'confirmed'}</span>}
            <Link className="btn btn-sm" href="/app/resupply">See the order</Link>
          </div>
        )}
        <div className={s.foot}>
          {tools.map(t => <span key={t} className="tool-chip" style={{ fontFamily: 'var(--font)' }}>{t}</span>)}
          <span className={`${s.author} ${authorCls}`}>{authorText}</span>
          <span className={s.sig} title="This message is signed, so nobody can change it later.">
            <svg width="11" height="11" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l4 4 10-10" fill="none" stroke="#12A150" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>
            verified
          </span>
        </div>
      </div>
    </div>
  );
}
