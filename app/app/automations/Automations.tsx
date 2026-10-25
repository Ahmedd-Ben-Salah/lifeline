'use client';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useApi, useMe, post, useLive, useNow } from '@/lib/client/live';
import { useToast } from '@/lib/client/toast';
import { Chip, Seg, Skeleton, ErrorCard } from '@/components/ui';
import { can } from '@/lib/auth/permissions';
import type { automationsView } from '@/lib/server/automations';
import s from './automations.module.css';
import AgentBuilder, { Catalog } from '@/components/automations/AgentBuilder';

type A = ReturnType<typeof automationsView>;
type Auto = A['automations'][number];
type Node = Auto['graph']['nodes'][number];
const WIDTH: Record<string, number> = { source: 175, agent: 215, tools: 215, condition: 215, actions: 225 };

export default function Automations() {
  const { data, error, reload } = useApi<A>('/api/automations');
  const me = useMe();
  const { bump } = useLive();
  const toast = useToast();
  const [sel, setSel] = useState('storm-response');
  const [tab, setTab] = useState<'graph' | 'runs'>('graph');
  const [pos, setPos] = useState<Record<string, { x: number; y: number }>>({});
  const [dirty, setDirty] = useState(false);
  const [sizes, setSizes] = useState<Record<string, { w: number; h: number }>>({});
  const [dragId, setDragId] = useState<string | null>(null);
  const nodeRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const admin = can(me?.role, 'editAutomation');
  const builder = me?.role === 'ADMIN' || me?.role === 'OPERATOR';
  const [mode, setMode] = useState<'view' | 'new' | 'edit'>('view');
  const now = useNow(15000);
  const a = data?.automations.find(x => x.id === sel) ?? data?.automations[0];
  const canEdit = (x?: Auto) => !!x && (x.custom ? builder : admin);

  useEffect(() => { if (a && !dirty) setPos(Object.fromEntries(a.graph.nodes.map(n => [n.id, { x: n.x, y: n.y }]))); }, [a, dirty]);
  useLayoutEffect(() => {
    const next: Record<string, { w: number; h: number }> = {};
    Object.entries(nodeRefs.current).forEach(([id, el]) => { if (el) next[id] = { w: el.offsetWidth, h: el.offsetHeight }; });
    if (JSON.stringify(next) !== JSON.stringify(sizes)) setSizes(next);
  });

  const wires = useMemo(() => {
    if (!a) return [];
    return a.graph.edges.map(([f, t]) => {
      const pf = pos[f], pt = pos[t], sf = sizes[f], st = sizes[t];
      if (!pf || !pt || !sf || !st) return null;
      const vertical = pt.y > pf.y + sf.h - 10 && Math.abs(pt.x - pf.x) < sf.w * 0.6;
      let d: string;
      if (vertical) { const x1 = pf.x + sf.w / 2, y1 = pf.y + sf.h, x2 = pt.x + st.w / 2, y2 = pt.y; const m = (y2 - y1) / 2; d = `M${x1} ${y1} C${x1} ${y1 + m} ${x2} ${y2 - m} ${x2} ${y2}`; }
      else { const x1 = pf.x + sf.w, y1 = pf.y + 22, x2 = pt.x, y2 = pt.y + 22; const m = Math.max(30, (x2 - x1) / 2); d = `M${x1} ${y1} C${x1 + m} ${y1} ${x2 - m} ${y2} ${x2} ${y2}`; }
      const hot = a.lastRun?.hot.includes(`${f}-${t}`) ?? false;
      return { id: `${f}-${t}`, d, hot };
    }).filter(Boolean) as { id: string; d: string; hot: boolean }[];
  }, [a, pos, sizes]);

  function startDrag(e: React.PointerEvent, n: Node) {
    if (!admin || a?.custom) return;
    e.preventDefault();
    const start = { x: e.clientX, y: e.clientY, ox: pos[n.id].x, oy: pos[n.id].y };
    const zoom = parseFloat(getComputedStyle((e.currentTarget as HTMLElement).closest(`.${s.graph}`)!).zoom || '1') || 1;
    setDragId(n.id);
    const move = (ev: PointerEvent) => { setPos(p => ({ ...p, [n.id]: { x: Math.max(0, Math.round((start.ox + (ev.clientX - start.x) / zoom) / 4) * 4), y: Math.max(0, Math.round((start.oy + (ev.clientY - start.y) / zoom) / 4) * 4) } })); setDirty(true); };
    const up = () => { setDragId(null); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  }
  async function save(status?: 'LIVE' | 'OFF', target: Auto | undefined = a) {
    if (!target) return;
    try { await post(`/api/automations/${target.id}`, status ? { status } : { positions: pos }, 'PUT'); if (!status) setDirty(false); toast(status ? `${target.name} is ${status === 'LIVE' ? 'on' : 'off'}` : `Saved layout of ${target.name}`); bump(); reload(); }
    catch (err) { toast((err as Error).message, true); }
  }
  async function remove(x: Auto) {
    if (!confirm(`Delete the agent “${x.name}”?`)) return;
    try { await post(`/api/automations/${x.id}`, undefined, 'DELETE'); toast(`Deleted ${x.name}`); setSel('storm-response'); bump(); reload(); }
    catch (err) { toast((err as Error).message, true); }
  }
  async function approvePending(x: Auto) {
    try { const r = await post<{ done: string }>(`/api/automations/${x.id}/approve`); toast(`Done: ${r.done}`); bump(); reload(); }
    catch (err) { toast((err as Error).message, true); }
  }
  const ago = (ms: number) => { const m = Math.max(0, Math.round((now - ms) / 60000)); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`; };

  if (error && !data) return <main className="page"><ErrorCard what="automations" onRetry={reload} /></main>;

  return (
    <div className={s.au}>
      <aside className={s.list} aria-label="Agents and automations">
        <div style={{ display: 'flex', alignItems: 'center', padding: '6px 6px 10px 10px' }}>
          <span className="eyebrow">Your agents</span>
          {builder && <button className="btn btn-sm btn-dark" style={{ marginLeft: 'auto' }} onClick={() => setMode('new')}>+ New agent</button>}
        </div>
        {(data?.automations ?? []).map(x => (
          <div key={x.id} className={s.item2} aria-current={mode === 'view' && x.id === a?.id}>
            <button className={s.itemMain} onClick={() => { setSel(x.id); setDirty(false); setMode('view'); }}>
              <span className={s.itemName}>{x.name}{x.custom ? <span className={s.mine}>custom</span> : <span className={s.mine} data-b="1">built-in</span>}</span>
              <span className={s.itemRes}>{x.status === 'OFF' ? 'Off' : x.pending ? 'Waiting for your OK' : x.lastResult ? `${x.lastResult.fired ? `Acted ${ago(x.lastResult.atMs)}: ` : ''}${x.lastResult.text}` : 'Waiting — nothing to do'}</span>
            </button>
            <input type="checkbox" className="toggle" checked={x.status === 'LIVE'} disabled={!canEdit(x)} aria-label={`${x.name} on or off`} title={canEdit(x) ? '' : 'You cannot change this one'} onChange={() => save(x.status === 'LIVE' ? 'OFF' : 'LIVE', x)} />
          </div>
        ))}
        {!builder && <div className="faint" style={{ fontSize: 12, padding: '12px 10px 0' }}>Only operators and admins can build agents.</div>}
      </aside>

      <section className={s.canvas + ' dots-bg'} aria-label="Automation graph">
        {mode !== 'view' && data && (
          <>
            <div className={s.top}><b style={{ fontSize: 15 }}>{mode === 'new' ? 'Build a new agent' : `Edit ${a?.name}`}</b><span className="muted" style={{ fontSize: 13 }}>Pick what it watches, set a limit, choose what it does.</span></div>
            <AgentBuilder catalog={data.catalog as Catalog} colonies={data.colonies} initial={mode === 'edit' && a?.rule ? { id: a.id, name: a.name, rule: a.rule } : undefined}
              onDone={id => { setMode('view'); if (id) setSel(id); bump(); reload(); }} />
          </>
        )}
        {mode === 'view' && <>
        <div className={s.top}>
          <b style={{ fontSize: 15 }}>{a?.name ?? '…'}</b>
          {a && <Chip tone={a.status === 'LIVE' ? 'ok' : 'off'}>{a.status === 'LIVE' ? 'On' : 'Off'}</Chip>}
          {a && !a.custom && <Seg label="View" value={tab} onChange={setTab} options={[{ value: 'graph', label: 'How it works' }, { value: 'runs', label: 'Last run' }]} />}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            {a && canEdit(a) && <button className="btn btn-sm" onClick={() => save(a.status === 'LIVE' ? 'OFF' : 'LIVE')}>{a.status === 'LIVE' ? 'Turn off' : 'Turn on'}</button>}
            {a?.custom && builder && <><button className="btn btn-sm" onClick={() => setMode('edit')}>Edit</button><button className="btn btn-sm" style={{ color: 'var(--crit)' }} onClick={() => remove(a)}>Delete</button></>}
            {a && !a.custom && admin && <button className="btn btn-sm btn-dark" disabled={!dirty} onClick={() => save()}>Save layout</button>}
            {a && !canEdit(a) && <span className="faint" style={{ fontSize: 12 }}>Read only</span>}
          </div>
        </div>
        {a?.custom && (
          <div className={s.summary}>
            <p className={s.sentence}>{a.sentence}</p>
            {a.pending && (
              <div className={s.pending} role="status">
                <span><b>Waiting for your OK.</b> It wants to: {a.pending.text}</span>
                {builder && <button className="btn btn-sm btn-dark" onClick={() => approvePending(a)}>Approve</button>}
              </div>
            )}
            {a.lastResult && !a.pending && <div className="muted" style={{ fontSize: 13 }}>{a.lastResult.fired ? `Last action ${ago(a.lastResult.atMs)}: ` : ''}{a.lastResult.text}{a.lastResult.fired && <> · <Link href="/app/comms/my-agents">see messages</Link></>}</div>}
          </div>
        )}
        {!a && <div style={{ padding: 20 }}><Skeleton h={500} /></div>}
        {a && (a.custom || tab === 'graph') && (
          <>
            <div className={s.graph}>
              <svg className={s.wires} width="1180" height="640" aria-hidden="true">
                <defs><marker id="arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L8 4L0 8z" fill="#8A919C" /></marker><marker id="arrh" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L8 4L0 8z" fill="#2F6FEB" /></marker></defs>
                {wires.map(w => <path key={w.id} d={w.d} fill="none" stroke={w.hot ? '#2F6FEB' : '#C3C8D0'} strokeWidth={w.hot ? 1.8 : 1.4} className={w.hot ? 'wire-live' : undefined} markerEnd={`url(#${w.hot ? 'arrh' : 'arr'})`} />)}
              </svg>
              {a.graph.nodes.map(n => (
                <div key={n.id} ref={el => { nodeRefs.current[n.id] = el; }} className={`${s.node} ${admin ? s.drag : ''} ${dragId === n.id ? s.dragging : ''}`}
                  style={{ left: pos[n.id]?.x ?? n.x, top: pos[n.id]?.y ?? n.y, ['--w' as string]: `${WIDTH[n.type] ?? 200}px` } as React.CSSProperties}>
                  <NodeCard n={n} a={a} onGrab={e => startDrag(e, n)} />
                </div>
              ))}
            </div>
            {!a.custom && <RunCard a={a} />}
          </>
        )}
        {a && !a.custom && tab === 'runs' && <div style={{ paddingTop: 4 }}><RunCard a={a} full /></div>}
        </>}
      </section>
    </div>
  );
}

function NodeCard({ n, a, onGrab }: { n: Node; a: Auto; onGrab: (e: React.PointerEvent) => void }) {
  const head = (icon: React.ReactNode, right?: React.ReactNode) => (
    <div className="head" onPointerDown={onGrab} style={{ height: 44 }}>{icon}<b style={{ fontSize: 13.5 }}>{n.label}</b><span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>{right}</span></div>
  );
  const ico = (d: string) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3A414B" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
  if (n.type === 'source') return <div className="ring"><div className="in">{head(null, n.badge ? <span className="tag t-info">{n.badge}</span> : <span className="count-badge">{n.count ?? 0}</span>)}</div></div>;
  if (n.type === 'agent') {
    const rows: [string, string][] = a.custom ? [['Checks', 'every minute'], ['Acts', a.rule?.needsOk ? 'after your OK' : 'on its own'], ['Numbers', 'from the engine']]
      : n.id === 'weather' ? [['Watches', 'dust storms'], ['Simulations', '300'], ['Alerts at', '70% chance'], ['Numbers', 'from the engine']]
      : n.id === 'jezero' ? [['Warns', 'Arcadia'], ['No reply in 20 min', 'acts alone'], ['Allowed', 'life-saving steps']]
      : [['Plans', 'next rocket launch'], ['Earth orders', 'need 2 people']];
    return <div className="ring lift"><div className="in">{head(ico('M7 18h10a4 4 0 0 0 0-8 5.5 5.5 0 0 0-10.5 1.5A3.3 3.3 0 0 0 7 18z'), <span className="live-dot" />)}{rows.map(([k, v]) => <div key={k} className={s.row}><span style={{ fontFamily: 'var(--font)', fontSize: 12.5 }}>{k}</span><span>{v}</span></div>)}</div></div>;
  }
  if (n.type === 'tools') return <div className="ring"><div className="in">{head(null, <span className="count-badge">{n.items?.length ?? 0}</span>)}{n.items?.map(t => <div key={t} className={s.row}><span>{t}</span><span className="faint">engine</span></div>)}</div></div>;
  if (n.type === 'condition') return <div className="ring"><div className="in">{head(ico('M12 3l9 9-9 9-9-9z'))}<div className={s.row} style={{ display: 'block', lineHeight: 1.6 }}>{n.expr}</div><div className={s.row} style={{ justifyContent: 'flex-start', gap: 6 }}><span className="chip chip-info">yes → act</span><span className="chip chip-neutral">no → keep watching</span></div></div></div>;
  return <div className="ring lift"><div className="in">{head(null, <span className="count-badge">{n.items?.length ?? 0}</span>)}{n.items?.map(t => { const [k, v] = t.split(' → '); return <div key={t} className={s.act}><small>{a.custom ? 'Action' : k === 'ORDER' ? 'Earth order · needs your OK' : k === 'ROUTE' ? 'Send a rover' : k === 'NOTIFY' ? 'Tell people' : k === 'NEED' ? 'Ask for help' : 'Ask for offers'}</small>{v}</div>; })}</div></div>;
}

function RunCard({ a, full }: { a: Auto; full?: boolean }) {
  const r = a.lastRun;
  return (
    <div className={`ring ${s.run}`}>
      <div className="in">
        <div className="head"><b>Last run</b>{r && <span className="faint" style={{ fontSize: 12 }}>{r.id} · {r.steps.filter(x => x.status === 'done').length} of {r.steps.length} steps done</span>}
          <span style={{ marginLeft: 'auto' }}>{r ? <Chip tone={r.status === 'AWAITING_APPROVAL' ? 'warn' : r.status === 'DONE' ? 'ok' : 'info'}>{r.status === 'AWAITING_APPROVAL' ? 'Awaiting approval' : r.status === 'DONE' ? 'Done' : 'Running'}</Chip> : <Chip tone="off">No runs yet</Chip>}</span></div>
        <div className="body">
          {r ? (full ? (
            <table className="table"><thead><tr><th>Time</th><th>Step</th><th>Status</th></tr></thead><tbody>{r.steps.map((x, i) => <tr key={i}><td className="num">{x.time || '—'}</td><td>{x.label}</td><td><span className={`${s.pill} ${s[x.status]}`}>{x.status === 'done' ? 'done' : x.status === 'wait' ? 'waiting' : 'not reached'}</span></td></tr>)}</tbody></table>
          ) : (
            <div className={s.pills}>{r.steps.map((x, i) => <span key={i} className={`${s.pill} ${s[x.status]}`}>{x.status === 'done' ? '✓' : x.status === 'wait' ? '◔' : '·'} {x.label}</span>)}</div>
          )) : <span className="muted" style={{ fontSize: 13 }}>Nothing has happened yet.</span>}
          {r?.status === 'AWAITING_APPROVAL' && <Link href="/app/resupply" style={{ fontSize: 12.5 }}>Approve the Earth order →</Link>}
        </div>
      </div>
    </div>
  );
}
