import { nextTransferCode } from '@/lib/agents/protocol';
/** Everything humans (and the demo panel) can do. Each action writes an audit entry. */
import { KM_PER_SOL, planRoute } from '@/lib/engine/router';
import { productionFactor, powerPct, Resource } from '@/lib/engine/resources';
import { SOL_DAYS } from '@/lib/sim';
import { makeMessage } from '@/lib/agents/protocol';
import { askAgents, writeProtocolMessage } from '@/lib/agents/llm';
import { scheduleStory, storyFacts, STORM_THREAD } from '@/lib/agents/story';
import { scripted } from '@/lib/agents/scripted';
import { mutate, replaceWorld } from './store';
import { resetWorld, prepareLiveReplay } from './world';
import { messageView } from './views';
import { earthDelayMs, stormAge, activeStorm, ensembleFor } from './model';
import type { World, Policy, Approval } from './types';
import type { Session } from '@/lib/auth/session';

export function audit(w: World, actor: string, action: string, target: string, data?: Record<string, unknown>) {
  w.counters.audit += 1;
  w.audit.unshift({ id: `a${w.counters.audit}`, atMs: Date.now(), actor, action, target, data });
  if (w.audit.length > 200) w.audit.length = 200;
}

const opId = (s: Session) => (s.site === 'earth' ? (s.role === 'SUPPLIER' ? 'supplier' : 'earth-control') : `ops:${s.name.split(' ')[0].toLowerCase()}`);

// ---------- orders ----------
export async function approveOrder(s: Session, code: string, decision: 'GO' | 'CHANGES') {
  return mutate(w => {
    const o = w.orders.find(x => x.code === code);
    if (!o) throw new HttpError(404, 'Order not found');
    if (o.status !== 'AWAITING_APPROVAL') throw new HttpError(409, `This order is already ${o.status === 'SENT' ? 'sent' : o.status === 'CONFIRMED' ? 'confirmed' : 'a draft'}.`);
    if (o.approvals.some(a => a.userEmail === s.email)) throw new HttpError(409, 'You already approved. A second person must approve.');
    const now = Date.now();
    const th = w.threads.find(t => t.linked.order === code) ?? w.threads[0];
    if (s.site === 'earth') {
      const orderMsg = th.messages.find(m => m.kind === 'ORDER');
      if (orderMsg && orderMsg.deliverMs > now) throw new HttpError(409, `The order has not reached Earth yet. Messages need time to travel. It arrives in ${Math.ceil((orderMsg.deliverMs - now) / 1000)} s.`);
    }
    const delay = earthDelayMs(w, now);
    // Mars approvals must travel to Earth (where the manifest is locked); Earth approvals act at once on Earth.
    const ap: Approval = { userEmail: s.email, name: s.name, role: s.role, site: s.site, decision, atMs: now, arrivesMs: s.site === 'mars' ? now + delay : now };
    o.approvals.push(ap);
    const body = decision === 'GO'
      ? `${s.name} approved the Earth order. ${o.approvals.filter(a => a.decision === 'GO').length} of ${o.approvalsRequired} people have approved.`
      : `${s.name} asked for changes to the Earth order.`;
    th.messages.push(makeMessage(w, th.id, { from: opId(s), to: s.site === 'mars' ? 'earth-control' : 'jezero-agent', kind: 'INFO', body, createdMs: now, deliverMs: now + delay, author: 'human', payload: [['Order', `Earth order ${code.replace('ORD-0', '#')}`], ['Answer', decision === 'GO' ? 'Approved' : 'Needs changes'], ['By', s.name]] }));
    if (decision === 'CHANGES') o.status = 'DRAFT';
    audit(w, s.email, `order.${decision.toLowerCase()}`, code);
    return { arrivesInMs: ap.arrivesMs - now };
  });
}

export async function confirmOrder(s: Session, code: string) {
  return mutate(w => {
    const o = w.orders.find(x => x.code === code);
    if (!o) throw new HttpError(404, 'Order not found');
    if (o.status !== 'SENT') throw new HttpError(409, 'This order still needs 2 approvals.');
    o.status = 'CONFIRMED';
    const th = w.threads.find(t => t.id === 'earth-channel') ?? w.threads[0];
    const now = Date.now();
    th.messages.push(makeMessage(w, th.id, { from: s.role === 'SUPPLIER' ? 'supplier' : 'earth-control', to: 'earth-supply-agent', kind: 'INFO', body: `The Earth order is confirmed. Factories will build it, and ${o.ships.length} rockets are booked.`, createdMs: now, deliverMs: now + earthDelayMs(w, now), author: 'human' }));
    audit(w, s.email, 'order.confirm', code);
    return {};
  });
}

// ---------- comms ----------
export async function ask(s: Session, threadId: string, question: string) {
  const agent = s.site === 'earth' ? 'earth-supply-agent' : 'jezero-agent';
  // 1) post the question
  const { w: w1, result: askMsg } = await mutate(w => {
    const th = w.threads.find(t => t.id === threadId);
    if (!th) throw new HttpError(404, 'Thread not found');
    const now = Date.now();
    const m = makeMessage(w, th.id, { from: opId(s), to: agent, kind: 'ASK', body: question, createdMs: now, author: 'human', askedBy: s.name });
    th.messages.push(m);
    audit(w, s.email, 'agent.ask', threadId, { question });
    return m;
  });
  // 2) let the agent work (outside the lock) on a snapshot of the world
  const ans = await askAgents(w1, question, agent);
  // 3) post the answer. The reply also carries both messages so the browser can show them
  //    even if a later refetch lands on another serverless instance.
  const { w: w2, result: ansMsg } = await mutate(w => {
    let th = w.threads.find(t => t.id === threadId);
    if (!th) { th = w.threads[0]; }
    const now = Date.now();
    const m = makeMessage(w, th.id, { from: agent, to: opId(s), kind: 'ANSWER', body: ans.body, tools: ans.tools, createdMs: now, author: ans.author, meta: { replyTo: askMsg.id } });
    if (!th.messages.some(x => x.id === askMsg.id)) th.messages.push(askMsg);
    th.messages.push(m);
    w.actionsToday += 1;
    return m;
  });
  return { question: messageView(w2, askMsg, s), answer: messageView(w2, ansMsg, s), author: ans.author };
}

export async function acceptOffer(s: Session, msgId: string) {
  return mutate(w => {
    for (const th of w.threads) {
      const m = th.messages.find(x => x.id === msgId);
      if (!m) continue;
      if (m.kind !== 'OFFER') throw new HttpError(400, 'Not an offer');
      if (m.accepted) throw new HttpError(409, 'Already accepted');
      m.accepted = true;
      const now = Date.now();
      th.messages.push(makeMessage(w, th.id, { from: opId(s), to: m.from, kind: 'ACCEPT', body: `${s.name} accepted the offer.`, createdMs: now, author: 'human' }));
      audit(w, s.email, 'offer.accept', msgId);
      return {};
    }
    throw new HttpError(404, 'Message not found');
  });
}

// ---------- logistics ----------
export async function createTransfer(s: Session, body: { from: string; to: string; rover: string; resource: Resource; kg: number }) {
  return mutate(w => {
    const a = w.colonies.find(c => c.slug === body.from), b = w.colonies.find(c => c.slug === body.to);
    const r = w.rovers.find(x => x.code === body.rover);
    if (!a || !b || a === b) throw new HttpError(400, 'Pick two different colonies');
    if (!r || r.status !== 'STANDBY') throw new HttpError(409, `Rover ${body.rover.replace('r-', '')} is busy right now.`);
    const kg = Math.max(0, Math.min(3000, Math.round(body.kg)));
    const st = a.stocks.find(x => x.resource === body.resource);
    if (!st || st.amount - kg < st.dailyUse * w.policy.thresholds.keepOwnReserveDays) throw new HttpError(409, `${a.name} would drop below its ${w.policy.thresholds.keepOwnReserveDays}-day reserve`);
    const p = planRoute(r.status === 'STANDBY' ? r.pos : a, b);
    if (!p) throw new HttpError(422, 'No safe road found.');
    const code = nextTransferCode(w);
    st.amount -= kg;
    w.transfers.unshift({ code, from: a.slug, to: b.slug, cargo: { [body.resource]: kg }, rover: r.code, status: 'IN_TRANSIT', requestedBy: s.email, reason: 'Manual transfer', createdMs: Date.now(), why: `Shortest drivable path on MOLA terrain: ${Math.round(p.km).toLocaleString()} km, max grade ${p.maxGradeDeg.toFixed(1)}°.` });
    Object.assign(r, { status: 'IN_TRANSIT', progress: 0, route: { from: a.slug, to: b.slug, path: p.path, km: p.km, etaSols: p.etaSols, maxGradeDeg: p.maxGradeDeg, departMs: Date.now() } });
    audit(w, s.email, 'transfer.create', code, body);
    return { code, km: p.km, etaSols: p.etaSols };
  });
}

// ---------- forecasts ----------
export async function rerunForecast(s: Session) {
  return mutate(w => {
    const st = activeStorm(w);
    if (!st) throw new HttpError(404, 'No active storm');
    st.runCount += 1; // same seed → identical ensemble (deterministic); new run id for the log
    audit(w, s.email, 'forecast.run', st.code, { seed: st.params?.seed });
    const e = ensembleFor(w, st)!;
    return { runs: e.runs, seed: e.seed };
  });
}

// ---------- policy ----------
export async function publishPolicy(s: Session, p: Pick<Policy, 'autonomy' | 'thresholds' | 'charter'> & { note?: string }) {
  return mutate(w => {
    w.policyHistory.unshift(w.policy);
    w.policy = { ...w.policy, autonomy: p.autonomy, thresholds: p.thresholds, charter: p.charter, note: p.note, version: w.policy.version + 1, publishedBy: s.name, publishedMs: Date.now() };
    audit(w, s.email, 'policy.publish', `v${w.policy.version}`, p as unknown as Record<string, unknown>);
    return w.policy;
  });
}

export async function saveAutomation(s: Session, id: string, positions: Record<string, { x: number; y: number }>, status?: 'LIVE' | 'OFF') {
  return mutate(w => {
    const a = w.automations.find(x => x.id === id);
    if (!a) throw new HttpError(404, 'Automation not found');
    a.graph.nodes.forEach(n => { const p = positions[n.id]; if (p) { n.x = Math.round(p.x); n.y = Math.round(p.y); } });
    if (status) a.status = status;
    a.version += 1;
    audit(w, s.email, 'automation.save', id);
    return a;
  });
}

// ---------- demo controls ----------
export async function demoReset(s: Session) {
  const w = resetWorld(Date.now());
  audit(w, s.email, 'demo.reset', 'world');
  await replaceWorld(w);
  return { ok: true };
}

/** Replays the S-17 response live: agents write each message now (LLM with scripted fallback). */
export async function demoReplay(s: Session) {
  const { w: snapshot } = await mutate(w => w);
  const fresh = prepareLiveReplay(snapshot, Date.now());
  const F = storyFacts(fresh);
  const keys = Object.keys(F.steps);
  const written = await Promise.all(keys.map(k => writeProtocolMessage(F.steps[k].from, F.steps[k].kind, F.steps[k].facts, scripted(k, F.steps[k].facts))));
  const bodies = Object.fromEntries(keys.map((k, i) => [k, written[i]]));
  fresh.threads = fresh.threads.filter(t => t.id !== STORM_THREAD);
  scheduleStory(fresh, Date.now() + 1500, true, bodies);
  audit(fresh, s.email, 'demo.replay', 'S-17', { llm: written.filter(x => x.author === 'llm').length });
  await replaceWorld(fresh);
  return { ok: true, llmMessages: written.filter(x => x.author === 'llm').length, total: keys.length };
}

export async function demoFailRover(s: Session) {
  return mutate(w => {
    const ev = w.schedule.find(e => e.type === 'fault');
    if (ev) { ev.atMs = Date.now(); w.schedule.sort((a, b) => a.atMs - b.atMs); }
    audit(w, s.email, 'demo.fail-rover', 'r-3');
    return { scheduled: !!ev };
  });
}

export async function demoEarthConfirm(s: Session) {
  return mutate(w => {
    const o = w.orders.find(x => x.status === 'AWAITING_APPROVAL');
    if (!o) throw new HttpError(409, 'No order is waiting for approval.');
    if (o.approvals.some(a => a.userEmail === 'control@earth.gov')) throw new HttpError(409, 'Earth control already approved.');
    const now = Date.now();
    o.approvals.push({ userEmail: 'control@earth.gov', name: 'Earth control', role: 'EARTH', site: 'earth', decision: 'GO', atMs: now, arrivesMs: now });
    const th = w.threads.find(t => t.linked.order === o.code) ?? w.threads[0];
    th.messages.push(makeMessage(w, th.id, { from: 'earth-control', to: 'jezero-agent', kind: 'INFO', body: 'Earth control approved the Earth order.', createdMs: now, deliverMs: now + earthDelayMs(w, now), author: 'human', payload: [['Order', `Earth order ${o.code.replace('ORD-0', '#')}`], ['Answer', 'Approved'], ['By', 'Earth control']] }));
    audit(w, s.email, 'demo.earth-confirm', o.code);
    return {};
  });
}

/** Jump the simulation one sol forward: stocks, rovers and the storm all move. */
export async function demoAdvance(s: Session, sols = 1) {
  return mutate(w => {
    for (let k = 0; k < sols; k++) advanceOneSol(w);
    audit(w, s.email, 'demo.advance', 'clock', { sols });
    return {};
  });
}

function advanceOneSol(w: World) {
  w.simOffsetDays += SOL_DAYS;
  const st = activeStorm(w);
  const e = st ? ensembleFor(w, st) : null;
  const age = st ? stormAge(w, st) : 0;
  for (const [ci, c] of w.colonies.entries()) {
    // storm arrives at a colony when its median arrival passes (if likely)
    const imp = e?.impacts[ci];
    if (imp && imp.probability >= 0.5 && imp.arrivalMedian !== null && age >= imp.arrivalMedian && c.power.localTau < (imp.tauP10 ?? 3)) {
      const before = powerPct(c.power);
      c.power.localTau = ((imp.tauP10 ?? 3) + (imp.tauP90 ?? 4)) / 2;
      const after = powerPct(c.power);
      c.stocks.forEach(x => { x.dailyMake = x.dailyMake * productionFactor(x.resource, after) / Math.max(0.05, productionFactor(x.resource, before)); });
    }
    c.stocks.forEach(x => { x.amount = Math.max(0, x.amount + x.dailyMake - x.dailyUse); });
  }
  for (const r of w.rovers) {
    if (r.status === 'LOADING' && r.route) { r.status = 'IN_TRANSIT'; const t = w.transfers.find(x => x.rover === r.code && x.status === 'LOADING'); if (t) t.status = 'IN_TRANSIT'; continue; }
    if (r.status !== 'IN_TRANSIT' || !r.route) continue;
    r.progress = Math.min(1, r.progress + KM_PER_SOL / r.route.km);
    r.batteryPct = Math.max(15, r.batteryPct - 4);
    if (r.progress >= 1) {
      const t = w.transfers.find(x => x.rover === r.code && x.status === 'IN_TRANSIT');
      const dest = w.colonies.find(c => c.slug === r.route!.to)!;
      if (t) { t.status = 'DELIVERED'; for (const [res, kg] of Object.entries(t.cargo)) { const x = dest.stocks.find(y => y.resource === res); if (x && kg) x.amount += kg; } }
      r.status = 'STANDBY'; r.pos = { lat: dest.lat, lon: dest.lon }; r.route = undefined; r.progress = 0;
    }
  }
}

export class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
