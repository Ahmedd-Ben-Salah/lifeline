'use client';
/**
 * Agent builder: WHEN (inputs) → IF (rule) → THEN (actions). Plain words, live sentence,
 * mini flow, and "Test now" against the real current numbers.
 */
import { useMemo, useState } from 'react';
import { post } from '@/lib/client/live';
import { useToast } from '@/lib/client/toast';
import type { AgentRule, AgentCheck, AgentAction, AgentInput } from '@/lib/server/types';
import s from './builder.module.css';

export interface Catalog {
  inputs: { id: AgentInput; label: string; unit: string; perColony: boolean; defaultOp: '<' | '>'; defaultValue: number; noNumber?: boolean }[];
  actions: { id: AgentAction['type']; label: string; hint: string }[];
}
interface Props { catalog: Catalog; colonies: { slug: string; name: string }[]; initial?: { id: string; name: string; rule: AgentRule }; onDone: (id?: string) => void }

const RES = [{ v: 'O2', l: 'air' }, { v: 'WATER', l: 'water' }, { v: 'FOOD', l: 'food' }] as const;
const RES_WORD: Record<string, string> = { O2: 'air', WATER: 'water', FOOD: 'food' };

export function sentence(rule: AgentRule, colonies: { slug: string; name: string }[]) {
  const where = (c: AgentCheck) => (c.colony === 'any' ? 'any colony' : colonies.find(x => x.slug === c.colony)?.name.split(' ')[0] ?? c.colony);
  const cmp = (c: AgentCheck) => (c.op === '<' ? 'less than' : 'more than');
  const when = rule.checks.map(c => {
    switch (c.input) {
      case 'airDays': return `${where(c)} has ${cmp(c)} ${c.value} days of air`;
      case 'waterDays': return `${where(c)} has ${cmp(c)} ${c.value} days of water`;
      case 'foodDays': return `${where(c)} has ${cmp(c)} ${c.value} days of food`;
      case 'powerPct': return `${where(c)} has ${cmp(c)} ${c.value}% power`;
      case 'stormChance': return `the storm chance for ${where(c)} is ${cmp(c)} ${c.value}%`;
      case 'stormWithin': return `a storm reaches ${where(c)} in ${cmp(c)} ${c.value} days`;
      case 'silentMin': return `${where(c)} is silent for more than ${c.value} minutes`;
      case 'roverDown': return 'a rover breaks down';
      case 'windowDays': return `the Earth launch window is ${cmp(c)} ${c.value} days away`;
      case 'deliveryArrives': return `a delivery reaches ${where(c)} within ${c.value} days`;
    }
  }).join(' and ');
  const then = rule.actions.map(a => {
    switch (a.type) {
      case 'warn': return 'warn everyone';
      case 'askHelp': return 'ask the other colonies for help';
      case 'sendRover': return `send a rover with ${a.kg ?? 300} kg of ${RES_WORD[a.resource ?? 'O2']} from the colony with the most to spare`;
      case 'earthOrder': return `add ${a.kg ?? 1000} kg of ${RES_WORD[a.resource ?? 'FOOD']} to the next Earth order`;
      case 'notify': return 'tell the operators';
    }
  }).join(', then ');
  return `When ${when || '…'}, ${then || '…'}.${rule.needsOk ? ' Ask me first.' : ''}`;
}

export default function AgentBuilder({ catalog, colonies, initial, onDone }: Props) {
  const toast = useToast();
  const [name, setName] = useState(initial?.name ?? '');
  const [checks, setChecks] = useState<AgentCheck[]>(initial?.rule.checks ?? [{ input: 'airDays', op: '<', value: 30, colony: 'any' }]);
  const [actions, setActions] = useState<AgentAction[]>(initial?.rule.actions ?? [{ type: 'warn' }]);
  const [needsOk, setNeedsOk] = useState(initial?.rule.needsOk ?? true);
  const [test, setTest] = useState<{ match: boolean; lines: string[]; wouldDo: string[] } | null>(null);
  const [busy, setBusy] = useState<'test' | 'save' | null>(null);
  const rule: AgentRule = useMemo(() => ({ checks, actions, needsOk }), [checks, actions, needsOk]);
  const inp = (id: AgentInput) => catalog.inputs.find(i => i.id === id)!;

  function toggleInput(id: AgentInput) {
    setTest(null);
    setChecks(cs => (cs.some(c => c.input === id) ? cs.filter(c => c.input !== id) : cs.length >= 4 ? cs : [...cs, { input: id, op: inp(id).defaultOp, value: inp(id).defaultValue, colony: 'any' }]));
  }
  function toggleAction(id: AgentAction['type']) {
    setTest(null);
    setActions(as => (as.some(a => a.type === id) ? as.filter(a => a.type !== id) : [...as, id === 'sendRover' ? { type: id, resource: 'O2', kg: 300 } : id === 'earthOrder' ? { type: id, resource: 'FOOD', kg: 1000 } : { type: id }]));
  }
  const setCheck = (i: number, p: Partial<AgentCheck>) => { setTest(null); setChecks(cs => cs.map((c, k) => (k === i ? { ...c, ...p } : c))); };
  const setAction = (t: AgentAction['type'], p: Partial<AgentAction>) => { setTest(null); setActions(as => as.map(a => (a.type === t ? { ...a, ...p } : a))); };

  async function runTest() {
    setBusy('test');
    try { setTest(await post('/api/automations/test', { rule })); } catch (e) { toast((e as Error).message, true); } finally { setBusy(null); }
  }
  async function save() {
    setBusy('save');
    try {
      const body = { name: name.trim() || 'My agent', rule };
      const r = initial ? await post<{ id: string }>(`/api/automations/${initial.id}`, body, 'PUT') : await post<{ id: string }>('/api/automations', { ...body, status: 'LIVE' });
      toast(initial ? 'Agent updated' : 'Agent created and switched on');
      onDone(r.id);
    } catch (e) { toast((e as Error).message, true); } finally { setBusy(null); }
  }

  return (
    <div className={s.wrap}>
      <div className={s.head}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <label className="eyebrow" htmlFor="ag-name">Agent name</label>
          <input id="ag-name" className="input" style={{ width: '100%', marginTop: 6 }} placeholder="e.g. Valles air guard" value={name} maxLength={40} onChange={e => setName(e.target.value)} />
        </div>
        <label className={s.ok}><input type="checkbox" className="toggle" checked={needsOk} onChange={e => { setNeedsOk(e.target.checked); setTest(null); }} /> Needs my OK before acting</label>
      </div>

      <div className={s.steps}>
        <section className={s.card}>
          <div className={s.num}>1</div>
          <h3>When…</h3>
          <p className="muted" style={{ fontSize: 12.5, margin: '2px 0 10px' }}>Pick what the agent watches.</p>
          <div className={s.chips}>
            {catalog.inputs.map(i => (
              <button key={i.id} type="button" className={s.chip} aria-pressed={checks.some(c => c.input === i.id)} onClick={() => toggleInput(i.id)}>
                <span className={s.box} aria-hidden="true" />{i.label}
              </button>
            ))}
          </div>
        </section>

        <section className={s.card}>
          <div className={s.num}>2</div>
          <h3>If…</h3>
          <p className="muted" style={{ fontSize: 12.5, margin: '2px 0 10px' }}>Set the limit. All of these must be true.</p>
          {!checks.length && <div className="faint" style={{ fontSize: 13 }}>Pick something in step 1.</div>}
          {checks.map((c, k) => {
            const meta = inp(c.input);
            return (
              <div key={c.input} className={s.rule}>
                <b>{meta.label}</b>
                {!meta.noNumber && <div className={s.row}>
                  <select className="select" value={c.op} onChange={e => setCheck(k, { op: e.target.value as '<' | '>' })} aria-label="Comparison"><option value="<">less than</option><option value=">">more than</option></select>
                  <input className="input" style={{ width: 84, height: 36 }} type="number" min={0} value={c.value} onChange={e => setCheck(k, { value: Number(e.target.value) })} aria-label="Limit" />
                  <span className="muted" style={{ fontSize: 12.5 }}>{meta.unit}</span>
                </div>}
                {meta.perColony && <select className="select" value={c.colony} onChange={e => setCheck(k, { colony: e.target.value })} aria-label="Colony">
                  <option value="any">at any colony</option>
                  {colonies.map(x => <option key={x.slug} value={x.slug}>at {x.name}</option>)}
                </select>}
              </div>
            );
          })}
        </section>

        <section className={s.card}>
          <div className={s.num}>3</div>
          <h3>Then…</h3>
          <p className="muted" style={{ fontSize: 12.5, margin: '2px 0 10px' }}>Choose what the agent does.</p>
          {catalog.actions.map(a => {
            const on = actions.find(x => x.type === a.id);
            return (
              <div key={a.id} className={s.act} data-on={!!on}>
                <label className={s.actLabel}><input type="checkbox" checked={!!on} onChange={() => toggleAction(a.id)} /><span><b>{a.label}</b><small>{a.hint}</small></span></label>
                {on && (a.id === 'sendRover' || a.id === 'earthOrder') && (
                  <div className={s.row} style={{ paddingLeft: 26 }}>
                    <input className="input" style={{ width: 90, height: 34 }} type="number" min={50} step={50} value={on.kg ?? 0} onChange={e => setAction(a.id, { kg: Number(e.target.value) })} aria-label="Kilograms" /><span className="muted" style={{ fontSize: 12.5 }}>kg of</span>
                    <select className="select" value={on.resource} onChange={e => setAction(a.id, { resource: e.target.value as 'O2' })} aria-label="Supply">{RES.map(r => <option key={r.v} value={r.v}>{r.l}</option>)}</select>
                  </div>
                )}
              </div>
            );
          })}
        </section>
      </div>

      <div className={s.preview}>
        <div className="eyebrow">In plain words</div>
        <p className={s.sentence}>{sentence(rule, colonies)}</p>
        <div className={s.flow} aria-label="How this agent works">
          <div className="ring"><div className="in"><div className={s.fnode}><small>Watches</small>{checks.map(c => <span key={c.input}>{inp(c.input).label}</span>)}{!checks.length && <span className="faint">nothing yet</span>}</div></div></div>
          <span className={s.arrow} aria-hidden="true">→</span>
          <div className="ring"><div className="in"><div className={s.fnode}><small>Checks</small>{checks.map(c => <span key={c.input} className="mono" style={{ fontSize: 12 }}>{inp(c.input).noNumber ? 'happens' : `${c.op === '<' ? '<' : '>'} ${c.value} ${inp(c.input).unit}`}</span>)}</div></div></div>
          <span className={s.arrow} aria-hidden="true">→</span>
          <div className="ring lift"><div className="in"><div className={s.fnode}><small>AI agent</small><span><span className="live-dot" style={{ display: 'inline-block', width: 8, height: 8, marginRight: 6 }} />{name.trim() || 'My agent'}</span>{needsOk && <span className="chip chip-warn" style={{ alignSelf: 'flex-start' }}>asks you first</span>}</div></div></div>
          <span className={s.arrow} aria-hidden="true">→</span>
          <div className="ring"><div className="in"><div className={s.fnode}><small>Does</small>{actions.map(a => <span key={a.type}>{catalog.actions.find(x => x.id === a.type)?.label}</span>)}{!actions.length && <span className="faint">nothing yet</span>}</div></div></div>
        </div>
        {test && (
          <div className={s.test} data-match={test.match} role="status">
            <b>{test.match ? 'Right now this agent WOULD act' : 'Right now nothing happens'}</b>
            <ul>{test.lines.map((l, i) => <li key={i} className={l.endsWith('✓') ? s.hit : undefined}>{l}</li>)}</ul>
            {test.match && <><div className="eyebrow" style={{ marginTop: 8 }}>It would</div><ul>{test.wouldDo.map((l, i) => <li key={i}>{l}</li>)}</ul></>}
          </div>
        )}
        <div className={s.btns}>
          <button className="btn" type="button" onClick={() => onDone()}>Cancel</button>
          <button className="btn" type="button" disabled={!checks.length || !actions.length || !!busy} onClick={runTest}>{busy === 'test' ? 'Testing…' : 'Test now'}</button>
          <button className="btn btn-dark" type="button" disabled={!checks.length || !actions.length || !!busy} onClick={save}>{busy === 'save' ? 'Saving…' : initial ? 'Save changes' : 'Create agent'}</button>
        </div>
      </div>
    </div>
  );
}
