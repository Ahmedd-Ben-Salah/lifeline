/**
 * The storm-S17 response, as a sequence of agent events.
 *
 *   WARN (weather) → NEED (jezero → arcadia) → [reply timeout] TIMEOUT → OFFER (utopia)
 *   → ACCEPT (jezero, auto under policy) → FAULT (logistics: r-3 down, r-7 rerouted) → ORDER (earth-supply, needs Go)
 *   → INFO report to Earth (light-delayed)
 *
 * Each step's numbers come from engine "facts" computed here. The agent (LLM or scripted
 * template) only turns those facts into words. Steps are queued in world.schedule and applied
 * when their time comes (tick), so the same code serves an instant reset and a live replay.
 */
import { planRoute, KM_PER_SOL, alongPath } from '@/lib/engine/router';
import { distanceKm, LatLon } from '@/lib/engine/geo';
import { spareCapacity } from '@/lib/engine/resources';
import { CATEGORY_LABEL, Category } from '@/lib/engine/packer';
import { dateFromJd } from '@/lib/engine/ephemeris';
import { simJd } from '@/lib/sim';
import { activeStorm, ensembleFor, stormSummary, colonyForecast, buildOrderPlan, earthDelayMs, timeoutMs, roverEtaSols } from '@/lib/server/model';
import { makeMessage, nextTransferCode } from './protocol';
import { settleOrders } from '@/lib/server/orders';
import { runCustomAgents } from '@/lib/server/customAgents';
import { scripted } from './scripted';
import type { World, Thread, Message, Scheduled, Kind, ToolUse } from '@/lib/server/types';

export const STORM_THREAD = 'storm-s17';
const ROVER_PAYLOAD_KG = 3000;
const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const pct = (x: number) => `${Math.round(x * 100)}%`;

export interface StepFacts {
  kind: Kind; from: string; to?: string;
  facts: Record<string, string | number>;
  payload: [string, string][];
  tools: ToolUse[];
}

function cone(w: World) {
  const s = activeStorm(w);
  const e = s && ensembleFor(w, s);
  if (!s || !e) return [];
  const ring: LatLon[] = [...e.cone.map(c => c.l90), ...e.cone.slice().reverse().map(c => c.r90)];
  const sum = stormSummary(w, s)!;
  return [{ ring, fromSol: Math.max(0, (sum.arrivalMin ?? 5) - 6), toSol: (sum.arrivalMax ?? 15) + 10, weight: 2.2 }];
}

/** Engine facts for every step, computed from the current world. */
export function storyFacts(w: World) {
  const s = activeStorm(w)!;
  const sum = stormSummary(w, s)!;
  const th = w.policy.thresholds;
  const col = (slug: string) => w.colonies.find(c => c.slug === slug)!;
  const arc = col('arcadia'), uto = col('utopia');

  // NEED: what Arcadia must receive to keep `criticalDays` of reserve through the 60-sol forecast
  const need: Record<string, number> = {};
  for (const r of ['WATER', 'O2'] as const) {
    const f = colonyForecast(w, 'arcadia', r)!;
    const st = arc.stocks.find(x => x.resource === r)!;
    need[r] = Math.max(0, Math.ceil((st.dailyUse * th.criticalDays - f.noActionMinRaw) / 10) * 10);
  }
  const lossKwh = (() => { const p = arc.power; const during = p.nuclearKw + p.solarKw * Math.exp(-0.313 * Math.max(0, ((sum.tauMin ?? 3) + (sum.tauMax ?? 4)) / 2 - 0.5)); const before = p.nuclearKw + p.solarKw * Math.exp(-0.313 * (p.localTau - 0.5)); return Math.max(0, before - during) * 24.66 * sum.durationSols * 0.6; })();

  // OFFER: Utopia gives only what keeps its own 90-day reserve, within one rover load (r-3's cargo needs room)
  const spare = (r: 'WATER' | 'O2') => { const st = uto.stocks.find(x => x.resource === r)!; const f = colonyForecast(w, 'utopia', r)!; return spareCapacity(st, th.keepOwnReserveDays, Math.min(...f.noAction)); };
  const cap = ROVER_PAYLOAD_KG - 900;
  const offerO2 = Math.floor(Math.min(need.O2, spare('O2'), 600) / 10) * 10;
  const offerWater = Math.floor(Math.min(need.WATER, spare('WATER'), cap - offerO2) / 50) * 50;

  // FAULT + reroute: r-3 dies on the direct Utopia→Arcadia route; r-7 detours via r-3 to recover its 900 kg water, avoiding the cone
  const r3 = w.rovers.find(r => r.code === 'r-3')!;
  const direct = planRoute(uto, arc)!;
  const r3pos = alongPath(direct.path, 0.42);
  const avoid = { cones: cone(w), departSol: 0 };
  const leg1 = planRoute(uto, r3pos, avoid)!;
  const leg2 = planRoute(r3pos, arc, { ...avoid, departSol: leg1.etaSols + 0.3 })!;
  const viaPath = [...leg1.path, ...leg2.path.slice(1)];
  const viaKm = leg1.km + leg2.km;
  const viaEta = viaKm / KM_PER_SOL + 0.3; // 0.3 sol to transfer r-3's cargo
  const directEta = direct.km / KM_PER_SOL;
  const directExposure = planRoute(uto, arc, { cones: avoid.cones.map(c => ({ ...c, weight: 0 })), departSol: 0 })!;
  const reroute = { leg1, leg2, viaPath, viaKm, viaEta, directKm: direct.km, directEta, r3pos, maxGrade: Math.max(leg1.maxGradeDeg, leg2.maxGradeDeg), exposure: leg1.coneExposureKm + leg2.coneExposureKm, directExposure: directExposure.coneExposureKm };

  // ORDER: launch window, packed ships, best landing zone
  const plan = buildOrderPlan(w);
  const jd = simJd(w);
  const depDays = plan.win.depJd - jd;
  const totalT = plan.ships.reduce((a, s) => a + s.massT, 0);

  const steps: Record<string, StepFacts> = {
    warn: {
      kind: 'WARN', from: 'weather-agent', to: 'network',
      facts: { storm: s.code, origin: s.origin, target: sum.targetName.split(' ')[0], runsReached: sum.runsReached, runs: sum.runs, chance: pct(sum.probability), probability: sum.probability.toFixed(2), arrivalMin: Math.round(sum.arrivalMin ?? 0), arrivalMax: Math.round(sum.arrivalMax ?? 0), solarLoss: pct(sum.solarLossMax ?? 0), durationSols: Math.round(sum.durationSols), runId: sum.runId },
      payload: [['Chance', `${pct(sum.probability)} to reach Arcadia`], ['When', `in ${Math.round(sum.arrivalMin ?? 0)} to ${Math.round(sum.arrivalMax ?? 0)} days`], ['Solar power', `drops ${pct(sum.solarLossMax ?? 0)} for about ${Math.round(sum.durationSols)} days`], ['Based on', '300 simulations']],
      tools: [{ name: 'storm_ensemble', args: { storm: s.code, runs: 300, seed: sum.seed }, ref: `run #${sum.runId}` }],
    },
    need: {
      kind: 'NEED', from: 'jezero-agent', to: 'arcadia-agent',
      facts: { water: fmt(need.WATER), o2: fmt(need.O2), powerMwh: (lossKwh / 1000).toFixed(1), criticalDays: th.criticalDays, target: 'Arcadia' },
      payload: [['Water needed', `${fmt(need.WATER)} kg`], ['Air needed', `${fmt(need.O2)} kg`], ['Power lost', `${(lossKwh / 1000).toFixed(1)} MWh`]],
      tools: [{ name: 'resource_forecast', args: { colony: 'arcadia', runs: 300, horizonSols: 60 }, ref: 'forecast · arcadia' }],
    },
    timeout: {
      kind: 'TIMEOUT', from: 'system',
      facts: { minutes: th.replyTimeoutMin, silent: 'arcadia-agent', actor: 'jezero-agent' },
      payload: [], tools: [],
    },
    offer: {
      kind: 'OFFER', from: 'utopia-agent', to: 'jezero-agent',
      facts: { water: fmt(offerWater), o2: fmt(offerO2), keepDays: th.keepOwnReserveDays, rover: 'r-7', eta: directEta.toFixed(1) },
      payload: [['Sends', `${fmt(offerWater)} kg water · ${fmt(offerO2)} kg air`], ['Carried by', 'Rover 7'], ['Trip', `${directEta.toFixed(1)} days`], ['Utopia keeps', `${th.keepOwnReserveDays} days for itself`]],
      tools: [{ name: 'resource_forecast', args: { colony: 'utopia', keepReserveDays: th.keepOwnReserveDays }, ref: 'forecast · utopia' }],
    },
    accept: {
      kind: 'ACCEPT', from: 'jezero-agent', to: 'utopia-agent',
      facts: { water: fmt(offerWater), o2: fmt(offerO2), policy: w.policy.autonomy.acceptOffer?.normal ?? 'NOTIFY', max: w.policy.autonomy.acceptOffer?.max ?? '2 t' },
      payload: [['Delivery', `#${w.counters.transfer}`], ['Rule used', 'AI does it and tells you']],
      tools: [],
    },
    fault: {
      kind: 'FAULT', from: 'logistics-agent', to: 'network',
      facts: { rover: 'r-3', stranded: '900', extraSols: Math.max(0, viaEta - directEta).toFixed(1), eta: viaEta.toFixed(1), km: fmt(viaKm), grade: reroute.maxGrade.toFixed(1), stormP10: (sum.arrivalMin ?? 0).toFixed(1), exposureAvoided: fmt(Math.max(0, reroute.directExposure - reroute.exposure)) },
      payload: [['New route', `Utopia → Rover 3 → Arcadia · ${fmt(viaKm)} km`], ['Arrives in', `${viaEta.toFixed(1)} days (${Math.max(0, viaEta - directEta).toFixed(1)} days later)`], ['Road', reroute.maxGrade < 2 ? 'flat' : reroute.maxGrade < 6 ? 'gentle slopes' : 'steep'], ['Picks up', '900 kg water from Rover 3']],
      tools: [{ name: 'rover_route', args: { rover: 'r-7', from: 'utopia', via: 'r-3', to: 'arcadia', avoid: 'storm cone p90' }, ref: 'A* · MOLA 1°' }],
    },
    order: {
      kind: 'ORDER', from: 'earth-supply-agent', to: 'earth-control',
      facts: { ships: plan.ships.length, tonnes: fmt(totalT), departure: dateFromJd(plan.win.depJd).toISOString().slice(0, 10), daysToWindow: Math.round(depDays), c3: plan.win.c3.toFixed(1), tof: Math.round(plan.win.tofDays), zone: plan.zones[0].name, zoneScore: plan.zones[0].score.toFixed(2) },
      payload: [['Cargo', `${fmt(totalT)} t · ${Object.keys(plan.demand).map(k => CATEGORY_LABEL[k as Category].toLowerCase()).join(', ')}`], ['Rockets leave', `in ${Math.round(depDays)} days`], ['Lands at', `${plan.zones[0].name.replace('-', ' ')} (best spot)`]],
      tools: [{ name: 'launch_window', args: {}, ref: `C3 ${plan.win.c3.toFixed(1)}` }, { name: 'cargo_plan', args: { ships: 3 }, ref: `${fmt(totalT)} t` }, { name: 'landing_zones', args: {}, ref: plan.zones[0].name }],
    },
    report: {
      kind: 'INFO', from: 'jezero-agent', to: 'earth-control',
      facts: { storm: s.code, chance: pct(sum.probability), probability: sum.probability.toFixed(2), transfer: `#${w.counters.transfer}`, order: '#312' },
      payload: [['Storm', `${pct(sum.probability)} chance to hit Arcadia`], ['Help on the way', 'Rover 7'], ['Earth must', 'approve order #312']],
      tools: [],
    },
  };
  return { steps, need, offer: { WATER: offerWater, O2: offerO2 }, reroute, plan, sum };
}

/** Queue the whole story starting at `t0`. `live` = spaced out in real time for the demo. */
export function scheduleStory(w: World, t0: number, live: boolean, bodies?: Record<string, { body: string; author: 'llm' | 'scripted' }>) {
  const F = storyFacts(w);
  const gap = live ? 4000 : 20000;
  const tmo = live ? timeoutMs(w) : w.policy.thresholds.replyTimeoutMin * 60000;
  const at = {
    warn: t0, need: t0 + gap, timeout: t0 + gap + tmo, offer: t0 + gap + tmo + gap, accept: t0 + gap + tmo + gap * 1.6,
    fault: t0 + gap + tmo + gap * 2.6, order: t0 + gap + tmo + gap * 3.6, report: t0 + gap + tmo + gap * 4.2,
  };
  const order: (keyof typeof at)[] = ['warn', 'need', 'timeout', 'offer', 'accept', 'fault', 'order', 'report'];
  for (const k of order) {
    const st = F.steps[k];
    const b = bodies?.[k] ?? { body: scripted(k, st.facts), author: 'scripted' as const };
    w.schedule.push({ id: `${k}-${t0}`, atMs: at[k], type: k === 'timeout' ? 'timeout' : k === 'accept' ? 'accept' : k === 'fault' ? 'fault' : k === 'order' ? 'order' : 'msg', data: { step: k, body: b.body, author: b.author, kind: st.kind, from: st.from, to: st.to ?? '', payload: st.payload, tools: st.tools, offer: F.offer, reroute: { path: F.reroute.viaPath, km: F.reroute.viaKm, eta: F.reroute.viaEta, grade: F.reroute.maxGrade, r3pos: F.reroute.r3pos, why: scripted('why', F.steps.fault.facts) } } as unknown as Record<string, unknown> });
  }
  w.schedule.sort((a, b) => a.atMs - b.atMs);
}

export function ensureStormThread(w: World, nowMs: number): Thread {
  let t = w.threads.find(x => x.id === STORM_THREAD);
  if (!t) {
    t = { id: STORM_THREAD, title: 'Dust storm: help for Arcadia', status: 'OPEN', linked: { storm: 'S-17' }, messages: [], createdMs: nowMs };
    w.threads.unshift(t);
  }
  return t;
}

function post(w: World, t: Thread, ev: Scheduled, extra: Partial<Message> = {}) {
  const d = ev.data as Record<string, unknown>;
  const toEarth = String(d.to || '').startsWith('earth');
  const m = makeMessage(w, t.id, {
    from: String(d.from), to: (d.to as string) || undefined, kind: d.kind as Kind, body: String(d.body),
    payload: d.payload as [string, string][], tools: d.tools as ToolUse[], createdMs: ev.atMs,
    deliverMs: toEarth ? ev.atMs + earthDelayMs(w, ev.atMs) : ev.atMs + (String(d.from) === 'system' ? 0 : 2000),
    author: d.author as Message['author'],
  });
  Object.assign(m, extra);
  t.messages.push(m);
  w.actionsToday += 1;
  return m;
}

/** Apply all scheduled events whose time has come. Returns true if the world changed. */
export function tick(w: World, nowMs: number): boolean {
  let changed = false;
  while (w.schedule.length && w.schedule[0].atMs <= nowMs) {
    const ev = w.schedule.shift()!;
    changed = true;
    const d = ev.data as Record<string, any>;
    const t = ensureStormThread(w, ev.atMs);
    switch (ev.type) {
      case 'msg': {
        post(w, t, ev);
        if (d.step === 'warn') { const s = activeStorm(w); if (s) s.status = 'RESPONSE'; t.linked.storm = 'S-17'; }
        if (d.step === 'report') t.linked.earth = 'report';
        break;
      }
      case 'timeout': {
        const arcadia = w.colonies.find(c => c.slug === 'arcadia')!;
        const need = [...t.messages].reverse().find(m => m.kind === 'NEED');
        const acked = need && t.messages.some(m => m.from === 'arcadia-agent' && m.createdMs > need.createdMs);
        if (!acked && !arcadia.agentOnline) post(w, t, ev);
        else post(w, t, { ...ev, data: { ...d, kind: 'INFO', from: 'arcadia-agent', body: 'We are here. Our supplies are checked. Thank you for the help.', payload: [] } });
        break;
      }
      case 'accept': {
        const offer = [...t.messages].reverse().find(m => m.kind === 'OFFER');
        if (offer) offer.accepted = true;
        const code = nextTransferCode(w);
        w.transfers.unshift({ code, from: 'utopia', to: 'arcadia', cargo: { WATER: d.offer.WATER, O2: d.offer.O2 }, rover: 'r-7', status: 'LOADING', requestedBy: 'jezero-agent', reason: 'Storm S-17 response', createdMs: ev.atMs });
        const r7 = w.rovers.find(r => r.code === 'r-7')!;
        r7.status = 'LOADING';
        t.linked.transfer = code;
        post(w, t, { ...ev, data: { ...d, payload: [['Delivery', `#${code.replace('TR-0', '')}`], ['Rule used', 'AI does it and tells you']] } }, { meta: { transfer: code } });
        break;
      }
      case 'fault': {
        const r3 = w.rovers.find(r => r.code === 'r-3')!;
        const r7 = w.rovers.find(r => r.code === 'r-7')!;
        const blocked = w.transfers.find(x => x.rover === 'r-3');
        r3.status = 'OFFLINE'; r3.fault = 'drive fault'; r3.batteryPct = 12;
        r3.pos = d.reroute.r3pos; r3.progress = 0.42;
        if (blocked) blocked.status = 'FAILED';
        const tr = w.transfers.find(x => x.rover === 'r-7' && x.status !== 'DELIVERED');
        if (tr) { tr.status = 'IN_TRANSIT'; tr.why = d.reroute.why; tr.cargo.WATER = (tr.cargo.WATER || 0) + 900; tr.reason = 'Storm S-17 response · recovers r-3 cargo'; }
        r7.status = 'IN_TRANSIT'; r7.progress = 0;
        r7.route = { from: 'utopia', to: 'arcadia', via: 'r-3', path: d.reroute.path, km: d.reroute.km, etaSols: d.reroute.eta, maxGradeDeg: d.reroute.grade, departMs: ev.atMs };
        post(w, t, ev);
        break;
      }
      case 'order': {
        const F = buildOrderPlan(w);
        const existing = w.orders.find(o => o.code === 'ORD-0312');
        if (!existing) w.orders.unshift({ code: 'ORD-0312', status: 'AWAITING_APPROVAL', approvalsRequired: Number(w.policy.autonomy.earthOrder?.approvers ?? 2), approvals: [], windowDepJd: F.win.depJd, tofDays: F.win.tofDays, c3: F.win.c3, vinfArr: F.win.vinfArr, landingZone: F.zones[0].name, demand: F.demand, ships: F.ships, createdMs: ev.atMs });
        t.status = 'NEEDS_YOU'; t.linked.order = 'ORD-0312';
        post(w, t, ev, { meta: { order: 'ORD-0312' } });
        break;
      }
      case 'earth-go': break;
    }
  }
  if (settleOrders(w, nowMs)) changed = true;
  if (runCustomAgents(w, nowMs)) changed = true;
  return changed;
}

export { roverEtaSols, distanceKm };
