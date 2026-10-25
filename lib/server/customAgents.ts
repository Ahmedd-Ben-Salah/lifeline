import { nextTransferCode } from '@/lib/agents/protocol';
/**
 * Custom agents — rules people build in the Agent builder (Automations page).
 *
 *   WHEN  every check matches (e.g. "Valles has less than 45 days of air")
 *   THEN  run the actions (warn, ask for help, send a rover, add to the Earth order, tell the operators)
 *   — optionally only after a human OK.
 *
 * All values come from the engine (colonyView, storm ensemble, router…). Rules are checked from
 * tick() at most once a minute per agent, and fire once per "episode" (when the rule starts matching).
 */
import { planRoute } from '@/lib/engine/router';
import { spareCapacity } from '@/lib/engine/resources';
import { itemsFromDemand, packCargo, Category } from '@/lib/engine/packer';
import { simJd } from '@/lib/sim';
import { makeMessage } from '@/lib/agents/protocol';
import { colonyView, activeStorm, ensembleFor, stormAge, nextWindow, roverEtaSols } from './model';
import type { World, Automation, AgentRule, AgentCheck, AgentAction, AgentInput, Thread } from './types';

export const AGENTS_THREAD = 'my-agents';
const EVAL_EVERY_MS = 60_000;

// ---------- catalog (what the builder offers) ----------
export const INPUTS: { id: AgentInput; label: string; unit: string; perColony: boolean; defaultOp: '<' | '>'; defaultValue: number; noNumber?: boolean }[] = [
  { id: 'airDays', label: 'Days of air left', unit: 'days', perColony: true, defaultOp: '<', defaultValue: 30 },
  { id: 'waterDays', label: 'Days of water left', unit: 'days', perColony: true, defaultOp: '<', defaultValue: 30 },
  { id: 'foodDays', label: 'Days of food left', unit: 'days', perColony: true, defaultOp: '<', defaultValue: 60 },
  { id: 'powerPct', label: 'Power level', unit: '%', perColony: true, defaultOp: '<', defaultValue: 50 },
  { id: 'stormChance', label: 'Storm chance', unit: '%', perColony: true, defaultOp: '>', defaultValue: 70 },
  { id: 'stormWithin', label: 'Storm arrives within', unit: 'days', perColony: true, defaultOp: '<', defaultValue: 14 },
  { id: 'silentMin', label: 'Colony silent for', unit: 'minutes', perColony: true, defaultOp: '>', defaultValue: 20 },
  { id: 'roverDown', label: 'A rover breaks down', unit: '', perColony: false, defaultOp: '>', defaultValue: 0, noNumber: true },
  { id: 'windowDays', label: 'Days until Earth launch window', unit: 'days', perColony: false, defaultOp: '<', defaultValue: 365 },
  { id: 'deliveryArrives', label: 'A delivery arrives within', unit: 'days', perColony: true, defaultOp: '<', defaultValue: 2 },
];
export const ACTIONS: { id: AgentAction['type']; label: string; hint: string }[] = [
  { id: 'warn', label: 'Warn everyone', hint: 'Posts a warning to all colonies' },
  { id: 'askHelp', label: 'Ask other colonies for help', hint: 'Asks the others what they can spare' },
  { id: 'sendRover', label: 'Send a rover with supplies', hint: 'From the colony with the most to spare' },
  { id: 'earthOrder', label: 'Add to the next Earth order', hint: 'Adds supplies to the rocket order' },
  { id: 'notify', label: 'Tell the operators', hint: 'A note for the people on duty' },
];
const RES_WORD: Record<string, string> = { O2: 'air', WATER: 'water', FOOD: 'food' };
const RES_CAT: Record<string, Category> = { O2: 'O2', WATER: 'WATER', FOOD: 'FOOD' };
const roverName = (code: string) => `Rover ${code.replace('r-', '')}`;
const colName = (w: World, slug: string) => w.colonies.find(c => c.slug === slug)?.name.split(' ')[0] ?? slug;
const n0 = (x: number) => Math.round(x).toLocaleString('en-US');

// ---------- plain-language sentence ----------
export function describeRule(w: World | null, rule: AgentRule) {
  const where = (c: AgentCheck) => (c.colony === 'any' ? 'any colony' : w ? colName(w, c.colony) : c.colony);
  const cmp = (c: AgentCheck) => (c.op === '<' ? 'less than' : 'more than');
  const when = rule.checks.map(c => {
    const inp = INPUTS.find(i => i.id === c.input)!;
    switch (c.input) {
      case 'airDays': case 'waterDays': case 'foodDays': return `${where(c)} has ${cmp(c)} ${c.value} days of ${c.input === 'airDays' ? 'air' : c.input === 'waterDays' ? 'water' : 'food'}`;
      case 'powerPct': return `${where(c)} has ${cmp(c)} ${c.value}% power`;
      case 'stormChance': return `the storm chance for ${where(c)} is ${cmp(c)} ${c.value}%`;
      case 'stormWithin': return `a storm reaches ${where(c)} in ${cmp(c)} ${c.value} days`;
      case 'silentMin': return `${where(c)} is silent for more than ${c.value} minutes`;
      case 'roverDown': return 'a rover breaks down';
      case 'windowDays': return `the Earth launch window is ${cmp(c)} ${c.value} days away`;
      case 'deliveryArrives': return `a delivery reaches ${where(c)} within ${c.value} days`;
      default: return inp?.label ?? c.input;
    }
  }).join(' and ');
  const then = rule.actions.map(a => {
    switch (a.type) {
      case 'warn': return 'warn everyone';
      case 'askHelp': return 'ask the other colonies for help';
      case 'sendRover': return `send a rover with ${n0(a.kg ?? 300)} kg of ${RES_WORD[a.resource ?? 'O2']} from the colony with the most to spare`;
      case 'earthOrder': return `add ${n0(a.kg ?? 1000)} kg of ${RES_WORD[a.resource ?? 'FOOD']} to the next Earth order`;
      case 'notify': return 'tell the operators';
    }
  }).join(', then ');
  return `When ${when || '…'}, ${then || '…'}.${rule.needsOk ? ' Ask me first.' : ''}`;
}

// ---------- evaluation ----------
export interface CheckResult { match: boolean; colonies: string[]; lines: string[] }

function evalCheck(w: World, c: AgentCheck, now: number): CheckResult {
  const cols = w.colonies.filter(x => c.colony === 'any' || x.slug === c.colony);
  const cmp = (v: number) => (c.op === '<' ? v < c.value : v > c.value);
  const lines: string[] = [], hits: string[] = [];
  const per = (slug: string, v: number, text: string) => { const ok = cmp(v); lines.push(`${text}${ok ? ' ✓' : ''}`); if (ok) hits.push(slug); };
  switch (c.input) {
    case 'airDays': case 'waterDays': case 'foodDays': {
      const res = c.input === 'airDays' ? 'O2' : c.input === 'waterDays' ? 'WATER' : 'FOOD';
      for (const col of cols) { const st = colonyView(w, col).stocks.find(s => s.resource === res)!; per(col.slug, st.days, `${colName(w, col.slug)} has ${Math.round(st.days)} days of ${RES_WORD[res]}`); }
      break;
    }
    case 'powerPct':
      for (const col of cols) { const p = colonyView(w, col).powerPct * 100; per(col.slug, p, `${colName(w, col.slug)} has ${Math.round(p)}% power`); }
      break;
    case 'stormChance': case 'stormWithin': {
      const s = activeStorm(w); const e = s ? ensembleFor(w, s) : null;
      if (!s || !e) { lines.push('No storm is being tracked'); break; }
      const age = stormAge(w, s, now);
      for (const col of cols) {
        const i = e.impacts.find(x => x.slug === col.slug)!;
        if (c.input === 'stormChance') per(col.slug, i.probability * 100, `Storm chance for ${colName(w, col.slug)}: ${Math.round(i.probability * 100)}%`);
        else if (i.arrivalMedian !== null && i.probability >= 0.3) per(col.slug, Math.max(0, i.arrivalMedian - age), `Storm reaches ${colName(w, col.slug)} in about ${Math.round(Math.max(0, i.arrivalMedian - age))} days`);
        else lines.push(`Storm is not expected at ${colName(w, col.slug)}`);
      }
      break;
    }
    case 'silentMin':
      for (const col of cols) { const m = col.agentOnline ? 0 : (now - col.agentLastSeenMs) / 60000; if (m > 0) per(col.slug, m, `${colName(w, col.slug)} has been silent for ${Math.round(m)} minutes`); else lines.push(`${colName(w, col.slug)} is online`); }
      break;
    case 'roverDown': {
      const down = w.rovers.filter(r => r.status === 'OFFLINE');
      down.forEach(r => { lines.push(`${roverName(r.code)} is broken ✓`); hits.push(r.home); });
      if (!down.length) lines.push('All rovers are working');
      break;
    }
    case 'windowDays': {
      const d = nextWindow(w).depJd - simJd(w, now);
      const ok = cmp(d); lines.push(`Next Earth launch window in ${Math.round(d)} days${ok ? ' ✓' : ''}`); if (ok) hits.push('network');
      break;
    }
    case 'deliveryArrives': {
      for (const col of cols) {
        const t = w.transfers.filter(x => x.to === col.slug && x.status === 'IN_TRANSIT').map(x => roverEtaSols(w.rovers.find(r => r.code === x.rover))).sort((a, b) => a - b)[0];
        if (t === undefined) lines.push(`No delivery on the way to ${colName(w, col.slug)}`);
        else { const ok = t <= c.value; lines.push(`Delivery reaches ${colName(w, col.slug)} in ${t.toFixed(1)} days${ok ? ' ✓' : ''}`); if (ok) hits.push(col.slug); }
      }
      break;
    }
  }
  return { match: hits.length > 0, colonies: hits, lines };
}

export function evaluateRule(w: World, rule: AgentRule, now = Date.now()) {
  const results = rule.checks.map(c => evalCheck(w, c, now));
  const match = results.length > 0 && results.every(r => r.match);
  // the colony the actions are about: first colony that matched a per-colony check
  const target = results.flatMap(r => r.colonies).find(s => w.colonies.some(c => c.slug === s)) ?? null;
  return { match, target, lines: results.flatMap(r => r.lines) };
}

// ---------- actions ----------
interface Plan { text: string; transfer?: { donor: string; rover: string; resource: 'O2' | 'WATER' | 'FOOD'; kg: number; km: number; etaSols: number; path: { lat: number; lon: number }[]; maxGradeDeg: number } }

/** Work out what each action would do right now (used by "Test now" and before acting). */
export function planActions(w: World, rule: AgentRule, target: string | null): Plan[] {
  const tName = target ? colName(w, target) : 'the network';
  return rule.actions.map(a => {
    switch (a.type) {
      case 'warn': return { text: `Warn everyone about ${tName}` };
      case 'askHelp': return { text: `Ask the other colonies to help ${tName}` };
      case 'notify': return { text: 'Tell the operators on duty' };
      case 'earthOrder': {
        const o = w.orders.find(x => x.status === 'AWAITING_APPROVAL' || x.status === 'DRAFT');
        return { text: o ? `Add ${n0(a.kg ?? 1000)} kg of ${RES_WORD[a.resource ?? 'FOOD']} to Earth order #${o.code.replace('ORD-0', '')}` : 'No open Earth order to add to' };
      }
      case 'sendRover': {
        const res = a.resource ?? 'O2', kg = Math.max(50, Math.min(3000, a.kg ?? 300));
        if (!target) return { text: 'Send a rover — but no colony matched' };
        const keep = w.policy.thresholds.keepOwnReserveDays;
        const donors = w.colonies.filter(c => c.slug !== target).map(c => { const st = c.stocks.find(s => s.resource === res)!; return { c, spare: spareCapacity(st, keep, st.amount) }; }).filter(d => d.spare >= kg).sort((x, y) => y.spare - x.spare);
        if (!donors.length) return { text: `No colony can spare ${n0(kg)} kg of ${RES_WORD[res]} without dropping below ${keep} days` };
        const donor = donors[0].c;
        const dest = w.colonies.find(c => c.slug === target)!;
        const free = w.rovers.filter(r => r.status === 'STANDBY').map(r => ({ r, d: Math.hypot(r.pos.lat - donor.lat, ((r.pos.lon - donor.lon + 540) % 360) - 180) })).sort((x, y) => x.d - y.d)[0];
        if (!free) return { text: 'No rover is free right now' };
        const p = planRoute({ lat: donor.lat, lon: donor.lon }, { lat: dest.lat, lon: dest.lon });
        if (!p) return { text: `No drivable route from ${colName(w, donor.slug)} to ${tName}` };
        return { text: `Send ${roverName(free.r.code)} with ${n0(kg)} kg of ${RES_WORD[res]} from ${colName(w, donor.slug)} to ${tName} (${n0(p.km)} km, about ${Math.ceil(p.etaSols)} days)`,
          transfer: { donor: donor.slug, rover: free.r.code, resource: res, kg, km: p.km, etaSols: p.etaSols, path: p.path, maxGradeDeg: p.maxGradeDeg } };
      }
    }
  });
}

function agentsThread(w: World, now: number): Thread {
  let t = w.threads.find(x => x.id === AGENTS_THREAD);
  if (!t) { t = { id: AGENTS_THREAD, title: 'Your agents', status: 'OPEN', linked: {}, messages: [], createdMs: now }; w.threads.push(t); }
  return t;
}
const agentFrom = (a: Automation) => a.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'custom-agent';

/** Carry out the planned actions (creates real transfers / order lines). Returns a one-line summary. */
export function executeActions(w: World, a: Automation, target: string | null, now: number, by: string) {
  const plans = planActions(w, a.rule!, target);
  const t = agentsThread(w, now);
  const tName = target ? colName(w, target) : 'the network';
  const done: string[] = [];
  a.rule!.actions.forEach((act, i) => {
    const plan = plans[i];
    if (act.type === 'warn') t.messages.push(makeMessage(w, t.id, { from: agentFrom(a), to: 'network', kind: 'WARN', body: `${a.name}: watch out for ${tName}.`, createdMs: now, author: 'scripted', meta: { agent: a.id } }));
    if (act.type === 'askHelp') t.messages.push(makeMessage(w, t.id, { from: agentFrom(a), to: 'network', kind: 'NEED', body: `${tName} needs help. Which colony can spare supplies?`, createdMs: now, author: 'scripted', meta: { agent: a.id } }));
    if (act.type === 'notify') t.messages.push(makeMessage(w, t.id, { from: agentFrom(a), to: 'operators', kind: 'INFO', body: `${a.name} matched: ${evaluateRule(w, a.rule!, now).lines.filter(l => l.endsWith('✓')).map(l => l.replace(' ✓', '')).join('; ') || tName}.`, createdMs: now, author: 'scripted', meta: { agent: a.id } }));
    if (act.type === 'earthOrder') {
      const o = w.orders.find(x => x.status === 'AWAITING_APPROVAL' || x.status === 'DRAFT');
      if (o) {
        const cat = RES_CAT[act.resource ?? 'FOOD'];
        o.demand[cat] = Math.round(((o.demand[cat] ?? 0) + (act.kg ?? 1000) / 1000) * 10) / 10;
        o.ships = packCargo(itemsFromDemand(o.demand), o.ships.map(s => s.ship)).ships;
      }
      t.messages.push(makeMessage(w, t.id, { from: agentFrom(a), to: 'earth-supply-agent', kind: 'INFO', body: plan.text + '.', createdMs: now, author: 'scripted', meta: { agent: a.id } }));
    }
    if (act.type === 'sendRover') {
      const tr = plan.transfer;
      if (tr && target) {
        const donor = w.colonies.find(c => c.slug === tr.donor)!;
        const st = donor.stocks.find(s => s.resource === tr.resource)!;
        st.amount -= tr.kg;
        const code = nextTransferCode(w);
        w.transfers.unshift({ code, from: tr.donor, to: target, cargo: { [tr.resource]: tr.kg }, rover: tr.rover, status: 'IN_TRANSIT', requestedBy: `${a.name} (agent)`, reason: a.name, createdMs: now, why: `Planned by ${a.name}: ${n0(tr.km)} km on real Mars terrain.` });
        const r = w.rovers.find(x => x.code === tr.rover)!;
        Object.assign(r, { status: 'IN_TRANSIT', progress: 0, route: { from: tr.donor, to: target, path: tr.path, km: tr.km, etaSols: tr.etaSols, maxGradeDeg: tr.maxGradeDeg, departMs: now } });
      }
      t.messages.push(makeMessage(w, t.id, { from: agentFrom(a), to: 'network', kind: tr ? 'OFFER' : 'INFO', body: plan.text + '.', createdMs: now, author: 'scripted', meta: { agent: a.id } }));
    }
    done.push(plan.text);
  });
  a.lastResult = { atMs: now, text: done.join(' · '), fired: true };
  w.audit.unshift({ id: `a${++w.counters.audit}`, atMs: now, actor: by, action: 'agent.fire', target: a.id, data: { target, actions: done } });
  w.actionsToday += 1;
  return done.join(' · ');
}

/** Called from tick(): check every LIVE custom agent at most once a minute. */
export function runCustomAgents(w: World, now: number): boolean {
  let changed = false;
  for (const a of w.automations) {
    if (!a.custom || !a.rule || a.status !== 'LIVE') continue;
    const st = (a.rule.state ??= {});
    if (st.lastEvalMs && now - st.lastEvalMs < EVAL_EVERY_MS) continue;
    st.lastEvalMs = now;
    const ev = evaluateRule(w, a.rule, now);
    if (ev.match && !st.active) {
      if (a.rule.needsOk) {
        if (!a.rule.pending) {
          const t = agentsThread(w, now);
          const plans = planActions(w, a.rule, ev.target).map(p => p.text);
          const m = makeMessage(w, t.id, { from: agentFrom(a), to: 'operators', kind: 'NEED', body: `${a.name} wants to act: ${plans.join('; ')}. Needs your OK.`, createdMs: now, author: 'scripted', meta: { agent: a.id, needsOk: true } });
          t.messages.push(m);
          a.rule.pending = { atMs: now, colony: ev.target ?? 'network', text: plans.join(' · '), msgId: m.id };
          a.lastResult = { atMs: now, text: `Waiting for your OK: ${plans.join(' · ')}`, fired: false };
        }
      } else executeActions(w, a, ev.target, now, `agent:${a.id}`);
      changed = true;
    } else if (!ev.match && !a.rule.pending) {
      if (st.active || !a.lastResult) { a.lastResult = { atMs: now, text: 'Waiting — nothing to do', fired: false }; changed = true; }
    }
    if (st.active !== ev.match) changed = true;
    st.active = ev.match;
  }
  return changed;
}

/** Approve a pending action of an agent that asks first. */
export function approvePending(w: World, id: string, by: string, now: number) {
  const a = w.automations.find(x => x.id === id);
  if (!a?.rule?.pending) return null;
  const target = a.rule.pending.colony === 'network' ? null : a.rule.pending.colony;
  const msgId = a.rule.pending.msgId;
  a.rule.pending = undefined;
  const text = executeActions(w, a, target, now, by);
  const t = w.threads.find(x => x.id === AGENTS_THREAD);
  const m = t?.messages.find(x => x.id === msgId);
  if (m) m.meta = { ...(m.meta ?? {}), needsOk: false, approvedBy: by };
  return text;
}

// ---------- graph for the "How it works" view ----------
export function graphFor(name: string, rule: AgentRule): Automation['graph'] {
  const nodes: Automation['graph']['nodes'] = [];
  rule.checks.forEach((c, i) => nodes.push({ id: `in${i}`, type: 'source', label: INPUTS.find(x => x.id === c.input)?.label ?? c.input, badge: c.colony === 'any' ? 'any colony' : c.colony, x: 20, y: 40 + i * 84 }));
  nodes.push({ id: 'cond', type: 'condition', label: 'Check', expr: rule.checks.map(c => `${INPUTS.find(x => x.id === c.input)?.label ?? c.input} ${c.op} ${c.value}`).join(' and '), x: 290, y: 40 });
  nodes.push({ id: 'agent', type: 'agent', label: name, x: 620, y: 40 });
  nodes.push({ id: 'actions', type: 'actions', label: rule.needsOk ? 'Actions (after your OK)' : 'Actions', items: rule.actions.map(a => `${a.type.toUpperCase()} → ${ACTIONS.find(x => x.id === a.type)?.label ?? a.type}${a.type === 'sendRover' || a.type === 'earthOrder' ? ` (${a.kg ?? 0} kg ${RES_WORD[a.resource ?? 'O2']})` : ''}`), x: 910, y: 40 });
  return { nodes, edges: [...rule.checks.map((_, i) => [`in${i}`, 'cond'] as [string, string]), ['cond', 'agent'], ['agent', 'actions']] };
}

/** Validate + normalise a rule from the client. */
export function cleanRule(raw: unknown, colonies: string[]): AgentRule | string {
  const r = raw as Partial<AgentRule> | null;
  if (!r || !Array.isArray(r.checks) || !r.checks.length) return 'Pick at least one input (WHEN).';
  if (!Array.isArray(r.actions) || !r.actions.length) return 'Pick at least one action (THEN).';
  const checks: AgentCheck[] = [];
  for (const c of r.checks.slice(0, 4)) {
    const inp = INPUTS.find(i => i.id === c?.input);
    if (!inp) return 'Unknown input.';
    const colony = inp.perColony && c.colony && (c.colony === 'any' || colonies.includes(c.colony)) ? c.colony : 'any';
    const value = Number(c.value);
    if (!inp.noNumber && !Number.isFinite(value)) return `Give a number for “${inp.label}”.`;
    checks.push({ input: inp.id, op: c.op === '>' ? '>' : '<', value: inp.noNumber ? 0 : Math.max(0, Math.min(10000, value)), colony });
  }
  const actions: AgentAction[] = [];
  for (const a of r.actions.slice(0, 5)) {
    if (!ACTIONS.some(x => x.id === a?.type)) return 'Unknown action.';
    const res = a.resource && ['O2', 'WATER', 'FOOD'].includes(a.resource) ? a.resource : undefined;
    actions.push({ type: a.type, ...(a.type === 'sendRover' || a.type === 'earthOrder' ? { resource: res ?? (a.type === 'sendRover' ? 'O2' : 'FOOD'), kg: Math.max(50, Math.min(a.type === 'sendRover' ? 3000 : 20000, Number(a.kg) || 300)) } : {}) });
  }
  return { checks, actions, needsOk: !!r.needsOk };
}
