/**
 * Page payloads. Each function turns the world into exactly what one screen needs,
 * with every number computed by the engine at request time.
 */
import { dateFromJd, helio, lightDelaySec, marsLs, sunEarthMarsAngleDeg } from '@/lib/engine/ephemeris';
import { porkchop, trajectoryPoints, Porkchop } from '@/lib/engine/lambert';
import { seasonActivity, seasonRisk, watchProbability, GLOBAL_STORM_YEARS } from '@/lib/engine/season';
import { describe, KM_PER_SOL } from '@/lib/engine/router';
import { solarLossPct } from '@/lib/engine/storm';
import { CATEGORY_LABEL } from '@/lib/engine/packer';
import { simJd, clockSnapshot, msgTime, SOL_DAYS } from '@/lib/sim';
import { activeStorm, colonyView, ensembleFor, stormSummary, stormAge, colonyForecast, buildOrderPlan, nextWindow, roverEtaSols, roverPos, earthDelayMs } from './model';
import { isEarthAgent } from '@/lib/agents/protocol';
import type { World, Message, Thread, Rover } from './types';
import type { Session } from '@/lib/auth/session';
import type { Resource } from '@/lib/engine/resources';

const now = () => Date.now();

// ---------- messages ----------
export function messageView(w: World, m: Message, viewer?: Session | null) {
  const t = now();
  const fromEarth = isEarthAgent(m.from) || m.from === 'earth-control';
  const viewerOnEarth = viewer?.site === 'earth';
  const senderSide = fromEarth ? 'earth' : 'mars';
  const delivered = m.deliverMs <= t;
  const viewerSide = viewerOnEarth ? 'earth' : 'mars';
  const visible = delivered || senderSide === viewerSide;
  return {
    id: m.id, threadId: m.threadId, from: m.from, to: m.to, kind: m.kind, body: m.body, payload: m.payload ?? [], tools: m.tools ?? [],
    signature: m.signature, author: m.author, accepted: m.accepted, meta: m.meta ?? {}, askedBy: m.askedBy,
    createdMs: m.createdMs, deliverMs: m.deliverMs, time: msgTime(w, m.createdMs), delivered, visible,
    crossesLink: isEarthAgent(m.to) !== fromEarth && (isEarthAgent(m.to) || fromEarth),
  };
}
export type MessageView = ReturnType<typeof messageView>;

export function threadView(w: World, th: Thread, viewer?: Session | null) {
  const msgs = th.messages.map(m => messageView(w, m, viewer)).filter(m => m.visible);
  return { id: th.id, title: th.title, status: th.status, linked: th.linked, earth: !!th.earth, createdMs: th.createdMs, messages: msgs, last: msgs[msgs.length - 1] ?? null, participants: [...new Set(th.messages.flatMap(m => [m.from, m.to].filter(Boolean) as string[]))].filter(p => p !== 'network' && p !== 'system') };
}

// ---------- storms ----------
export function stormView(w: World) {
  const s = activeStorm(w);
  if (!s) return null;
  const e = ensembleFor(w, s)!;
  const sum = stormSummary(w, s)!;
  const age = stormAge(w, s);
  const step = Math.min(e.cone.length - 1, Math.floor(age));
  return {
    ...sum, status: s.status, originLatLon: s.params!.origin,
    cone: e.cone.map(c => ({ ...c, sol: c.sol - age })),
    currentCentre: e.cone[step]?.centre ?? s.params!.origin,
    histogram: e.histogram.map(h => ({ sol: h.sol - Math.round(age), runs: h.runs })),
    impacts: e.impacts.map(i => ({ ...i, arrivalP10: i.arrivalP10 === null ? null : i.arrivalP10 - age, arrivalMedian: i.arrivalMedian === null ? null : i.arrivalMedian - age, arrivalP90: i.arrivalP90 === null ? null : i.arrivalP90 - age })),
    sampleTracks: e.sampleTracks.slice(0, 16),
    evidence: e.evidence, params: s.params,
  };
}

// ---------- overview ----------
export function overview(w: World, viewer?: Session | null) {
  const cols = w.colonies.map(c => colonyView(w, c));
  const lowest = cols.flatMap(c => c.stocks.map(s => ({ colony: c.name, slug: c.slug, resource: s.resource, days: s.days }))).sort((a, b) => a.days - b.days)[0];
  const storm = stormView(w);
  const moving = w.transfers.filter(t => t.status === 'IN_TRANSIT');
  const cargoKg = moving.reduce((s, t) => s + Object.values(t.cargo).reduce((a, b) => a + (b || 0), 0), 0);
  const nextEta = moving.map(t => ({ t, eta: roverEtaSols(w.rovers.find(r => r.code === t.rover)) })).sort((a, b) => a.eta - b.eta)[0];
  const win = nextWindow(w);
  const jd = simJd(w);
  const order = w.orders[0];
  const stream = w.threads.flatMap(t => t.messages.map(m => messageView(w, m, viewer))).filter(m => m.visible).sort((a, b) => a.createdMs - b.createdMs).slice(-8);
  const lowSeries = colonyForecast(w, lowest.slug, lowest.resource as Resource);
  return {
    clock: clockSnapshot(w),
    kpis: {
      lowest: { ...lowest, spark: lowSeries ? lowSeries.median.filter((_, i) => i % 6 === 0).map(v => v / (w.colonies.find(c => c.slug === lowest.slug)!.stocks.find(s => s.resource === lowest.resource)!.dailyUse)) : [] },
      storm: storm ? { code: storm.code, target: storm.targetName, probability: storm.probability, arrivalMin: storm.arrivalMin, arrivalMax: storm.arrivalMax, hist: storm.histogram.map(h => h.runs) } : null,
      cargo: { tonnes: cargoKg / 1000, etaSols: nextEta?.eta ?? null, to: nextEta ? w.colonies.find(c => c.slug === nextEta.t.to)?.name : null, count: moving.length },
      window: { depJd: win.depJd, depUtc: dateFromJd(win.depJd).toISOString(), daysLeft: win.depJd - jd, orderClosesDays: win.depJd - 365 - jd, synodicFrac: 1 - (win.depJd - jd) / 780 },
    },
    colonies: cols, storm,
    rovers: w.rovers.map(r => roverView(w, r)),
    stream,
    order: order ? orderSummary(w, order.code) : null,
    actionsToday: w.actionsToday,
    needsYou: w.orders.filter(o => o.status === 'AWAITING_APPROVAL').length,
  };
}

export function roverView(w: World, r: Rover) {
  const tr = w.transfers.find(t => t.rover === r.code && t.status !== 'DELIVERED' && t.status !== 'FAILED');
  return {
    code: r.code, home: r.home, status: r.status, batteryPct: r.batteryPct, fault: r.fault, pos: roverPos(r), progress: r.progress,
    route: r.route ? { ...r.route, remainingSols: roverEtaSols(r) } : null,
    transfer: tr ? { code: tr.code, from: tr.from, to: tr.to, cargo: tr.cargo, why: tr.why, status: tr.status, reason: tr.reason } : null,
  };
}

// ---------- forecasts ----------
export function forecasts(w: World) {
  const jd = simJd(w);
  const ls = marsLs(jd);
  // outlook: season activity over the next ~18 months (Ls sampled forward in time)
  const outlook = [] as { day: number; ls: number; activity: number }[];
  for (let d = 0; d <= 540; d += 6) { const l = marsLs(jd + d); outlook.push({ day: d, ls: l, activity: seasonActivity(l) }); }
  const win = nextWindow(w);
  const watch = w.storms.filter(s => s.horizon === 'WATCH').map(s => ({ code: s.code, origin: s.origin, target: s.target, region: s.watch!.region, tauTrend: s.watch!.tauTrend, areaKm2: s.watch!.areaKm2, probability: watchProbability(s.watch!.tauTrend, s.watch!.areaKm2, ls) }));
  return {
    clock: clockSnapshot(w), ls,
    storm: stormView(w),
    watch,
    outlook: { series: outlook, colonies: w.colonies.map(c => ({ slug: c.slug, name: c.name, lat: c.lat, risk: seasonRisk(c.lat) })), globalRate: GLOBAL_STORM_YEARS, arrivalDay: win.arrJd - jd, departDay: win.depJd - jd, perihelionNote: 'Peak near perihelion, Ls ≈ 251°' },
    colonies: w.colonies.map(c => ({ slug: c.slug, name: c.name, lat: c.lat, lon: c.lon, status: colonyView(w, c).status })),
  };
}

// ---------- logistics ----------
export function logistics(w: World) {
  const cols = w.colonies.map(c => colonyView(w, c));
  const r3 = w.rovers.find(r => r.code === 'r-3');
  return {
    clock: clockSnapshot(w),
    colonies: cols.map(c => ({ slug: c.slug, name: c.name, lat: c.lat, lon: c.lon, status: c.status })),
    rovers: w.rovers.map(r => roverView(w, r)),
    transfers: w.transfers.map(t => ({ ...t, etaSols: roverEtaSols(w.rovers.find(r => r.code === t.rover)), mass: Object.values(t.cargo).reduce((a, b) => a + (b || 0), 0) })),
    blockedRoute: r3?.status === 'OFFLINE' && r3.route ? r3.route.path : null,
    storm: stormView(w),
    kmPerSol: KM_PER_SOL,
    profiles: Object.fromEntries(w.rovers.filter(r => r.route).map(r => [r.code, describe(r.route!.path).profile.filter((_, i, a) => i % Math.max(1, Math.floor(a.length / 120)) === 0)])),
    faultsToday: w.rovers.filter(r => r.status === 'OFFLINE').length,
    active: w.rovers.filter(r => r.status !== 'OFFLINE' && r.status !== 'MAINTENANCE').length,
  };
}

// ---------- resupply ----------
let pcCache: { key: number; pc: Porkchop } | null = null;
export function porkchopFor(w: World) {
  const win = nextWindow(w);
  if (!pcCache || pcCache.key !== win.depJd) pcCache = { key: win.depJd, pc: porkchop(win.depJd - 60, win.depJd + 60, 150, 330, 120, 72) };
  return pcCache.pc;
}

export function orderSummary(w: World, code: string) {
  const o = w.orders.find(x => x.code === code);
  if (!o) return null;
  const t = now();
  return {
    ...o,
    approvals: o.approvals.map(a => ({ ...a, arrived: a.arrivesMs <= t })),
    goCount: o.approvals.filter(a => a.decision === 'GO').length,
    effectiveGo: o.approvals.filter(a => a.decision === 'GO' && a.arrivesMs <= t).length,
    totalT: o.ships.reduce((a, s) => a + s.massT, 0),
    departUtc: dateFromJd(o.windowDepJd).toISOString(), arriveUtc: dateFromJd(o.windowDepJd + o.tofDays).toISOString(),
    daysToDeparture: o.windowDepJd - simJd(w),
    categories: Object.entries(o.demand).map(([k, v]) => ({ key: k, label: CATEGORY_LABEL[k as keyof typeof CATEGORY_LABEL], tonnes: v })),
  };
}

export function resupply(w: World) {
  const plan = buildOrderPlan(w);
  const pc = porkchopFor(w);
  const jd = simJd(w);
  const traj = trajectoryPoints(plan.win, 160);
  const E = helio('earth', jd), M = helio('mars', jd);
  const earthOrbit = Array.from({ length: 121 }, (_, i) => helio('earth', jd + i * 365.256 / 120));
  const marsOrbit = Array.from({ length: 181 }, (_, i) => helio('mars', jd + i * 686.98 / 180));
  return {
    clock: clockSnapshot(w),
    window: { depJd: plan.win.depJd, depUtc: dateFromJd(plan.win.depJd).toISOString(), arrUtc: dateFromJd(plan.win.arrJd).toISOString(), tofDays: plan.win.tofDays, c3: plan.win.c3, vinfDep: plan.win.vinfDep, vinfArr: plan.win.vinfArr, daysLeft: plan.win.depJd - jd },
    porkchop: { ...pc, best: { depJd: pc.best.depJd, tofDays: pc.best.tofDays, c3: pc.best.c3 } },
    orbits: {
      earthNow: E, marsNow: M, earthDep: helio('earth', plan.win.depJd), marsArr: helio('mars', plan.win.arrJd),
      earthOrbit, marsOrbit, traj: traj.filter((_, i) => i % 2 === 0),
    },
    order: w.orders[0] ? orderSummary(w, w.orders[0].code) : null,
    plan: { demand: plan.demand, ships: plan.ships, unplaced: plan.unplaced },
    zones: plan.zones,
    lightDelaySec: lightDelaySec(jd), scaledDelayMs: earthDelayMs(w), sunAngle: sunEarthMarsAngleDeg(jd),
  };
}

// ---------- colony ----------
export function colonyDetail(w: World, slug: string, resource: Resource) {
  const c = w.colonies.find(x => x.slug === slug);
  if (!c) return null;
  const v = colonyView(w, c);
  const f = colonyForecast(w, slug, resource);
  const incoming = w.transfers.filter(t => t.to === slug && (t.status === 'IN_TRANSIT' || t.status === 'LOADING')).map(t => ({ ...t, etaSols: roverEtaSols(w.rovers.find(r => r.code === t.rover)) }));
  const storm = stormView(w);
  const impact = storm?.impacts.find(i => i.slug === slug) ?? null;
  return { clock: clockSnapshot(w), colony: v, forecast: f, incoming, storm: storm ? { code: storm.code, impact, solarLossMax: impact?.tauP90 ? solarLossPct(impact.tauP90) : null } : null, all: w.colonies.map(x => ({ slug: x.slug, name: x.name })), solDays: SOL_DAYS };
}

// ---------- traffic ----------
export function trafficSnapshot(w: World) {
  const plan = buildOrderPlan(w);
  return {
    clock: clockSnapshot(w),
    colonies: w.colonies.map(c => { const v = colonyView(w, c); return { slug: c.slug, name: c.name, lat: c.lat, lon: c.lon, status: v.status, population: c.population, lowest: v.lowest, powerPct: v.powerPct, agentOnline: c.agentOnline }; }),
    rovers: w.rovers.map(r => roverView(w, r)),
    blockedRoute: (() => { const r3 = w.rovers.find(r => r.code === 'r-3'); return r3?.status === 'OFFLINE' && r3.route ? r3.route.path : null; })(),
    storm: stormView(w),
    zones: plan.zones,
    window: { depJd: plan.win.depJd, tofDays: plan.win.tofDays, c3: plan.win.c3, arrJd: plan.win.arrJd },
    order: w.orders[0] ? { code: w.orders[0].code, status: w.orders[0].status, ships: w.orders[0].ships.map(s => ({ ship: s.ship, massT: s.massT, byCategory: s.byCategory })) } : null,
  };
}

export const msgSorted = (msgs: MessageView[]) => msgs.sort((a, b) => a.createdMs - b.createdMs);
