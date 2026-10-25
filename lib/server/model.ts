/**
 * Derived values. Nothing here is stored — every number on screen is recomputed
 * from the world state with the deterministic engine.
 */
import { runEnsemble, EnsembleResult, solarLossPct } from '@/lib/engine/storm';
import { reserveDays, powerPct, statusFromDays, forecastStock, Delivery, BVAD, Resource, StockForecast } from '@/lib/engine/resources';
import { findWindow } from '@/lib/engine/windows';
import { Transfer as Traj } from '@/lib/engine/lambert';
import { itemsFromDemand, packCargo, Category } from '@/lib/engine/packer';
import { scoreZones } from '@/lib/engine/landing';
import { KM_PER_SOL, alongPath } from '@/lib/engine/router';
import { distanceKm, LatLon } from '@/lib/engine/geo';
import { marsLs, lightDelaySec, inDustSeason } from '@/lib/engine/ephemeris';
import { simJd, missionSolF, SOL_DAYS, clockSnapshot } from '@/lib/sim';
import type { World, Colony, Storm, Rover } from './types';

// ---------- storm ensembles (memoised: pure function of params + colonies) ----------
const ensCache = new Map<string, EnsembleResult>();
export function ensembleFor(w: World, s: Storm): EnsembleResult | null {
  if (!s.params || !s.target) return null;
  const cols = w.colonies.map(c => ({ slug: c.slug, name: c.name, lat: c.lat, lon: c.lon }));
  const key = JSON.stringify([s.params, cols, s.target]);
  let e = ensCache.get(key);
  if (!e) {
    e = runEnsemble(s.params, cols, s.target, 300);
    const ls = marsLs(w.simEpochJd + w.simOffsetDays);
    e.evidence[1] = {
      kind: 'season',
      text: inDustSeason(ls)
        ? `Season Ls ${ls.toFixed(0)}° is inside the dust season (Ls 160°–340°), ${Math.abs(ls - 251) < 45 ? 'close to the perihelion peak (Ls 251°)' : 'away from the perihelion peak (Ls 251°)'}. Global storms began in this season in 2001, 2007 and 2018.`
        : `Season Ls ${ls.toFixed(0)}° is outside the main dust season (Ls 160°–340°).`,
      value: `Ls ${ls.toFixed(0)}°`,
    };
    if (ensCache.size > 50) ensCache.clear();
    ensCache.set(key, e);
  }
  return e;
}
export const activeStorm = (w: World) => w.storms.find(s => s.horizon === 'TRACK' && s.status !== 'PASSED');

/** Sols elapsed since the forecast was issued (storm moves on with the clock). */
export function stormAge(w: World, s: Storm, nowMs = Date.now()) {
  return Math.max(0, missionSolF(w, simJd(w, nowMs)) - s.issuedSol);
}

/** Summary used everywhere: probability, arrival window (relative to now), τ, solar loss. */
export function stormSummary(w: World, s: Storm, nowMs = Date.now()) {
  const e = ensembleFor(w, s);
  if (!e) return null;
  const age = stormAge(w, s, nowMs);
  const t = e.target;
  const rel = (x: number | null) => (x === null ? null : Math.max(0, x - age));
  return {
    code: s.code, origin: s.origin, target: s.target!, targetName: t.name,
    probability: t.probability, runsReached: t.runsReached, runs: e.runs, seed: e.seed,
    runId: `${e.seed}${s.runCount ? '-' + s.runCount : ''}`,
    arrivalMin: rel(t.arrivalP10), arrivalMedian: rel(t.arrivalMedian), arrivalMax: rel(t.arrivalP90),
    tauMin: t.tauP10, tauMax: t.tauP90,
    solarLossMin: t.tauP10 !== null ? solarLossPct(t.tauP10) : null,
    solarLossMax: t.tauP90 !== null ? solarLossPct(t.tauP90) : null,
    durationSols: e.durationSols.median,
    ageSols: age,
  };
}

// ---------- colonies ----------
export function colonyDeliveries(w: World, slug: string): Delivery[] {
  const out: Delivery[] = [];
  for (const t of w.transfers) {
    if (t.to !== slug || (t.status !== 'IN_TRANSIT' && t.status !== 'LOADING')) continue;
    const r = w.rovers.find(x => x.code === t.rover);
    const eta = roverEtaSols(r) + (t.status === 'LOADING' ? 0.5 : 0);
    for (const [res, kg] of Object.entries(t.cargo)) if (kg) out.push({ sol: Math.ceil(eta), resource: res as Resource, kg, label: `${t.code} · ${r?.code ?? ''} arrives` });
  }
  return out;
}

export function roverEtaSols(r?: Rover) {
  if (!r || !r.route) return 0;
  return Math.max(0, (1 - r.progress) * (r.route.etaSols || r.route.km / KM_PER_SOL));
}
export function roverPos(r: Rover): LatLon {
  if (r.route && (r.status === 'IN_TRANSIT')) return alongPath(r.route.path, r.progress);
  return r.pos;
}

export function colonyView(w: World, c: Colony) {
  const th = w.policy.thresholds;
  const stocks = c.stocks.map(s => {
    const days = reserveDays(s);
    return { ...s, days, status: statusFromDays(days, th), perPerson: s.dailyUse / c.population };
  });
  const lowest = stocks.reduce((a, b) => (a.days < b.days ? a : b));
  const pPct = powerPct(c.power);
  const status = statusFromDays(lowest.days, th);
  return {
    slug: c.slug, name: c.name, lat: c.lat, lon: c.lon, population: c.population,
    agentOnline: c.agentOnline, agentSilentMin: c.agentOnline ? 0 : Math.round((Date.now() - c.agentLastSeenMs) / 60000),
    stocks, lowest: { resource: lowest.resource, days: lowest.days }, powerPct: pPct,
    power: { ...c.power, availableKw: c.power.nuclearKw + c.power.solarKw * (1 - solarLossPct(c.power.localTau)) },
    status, equipment: c.equipment,
  };
}

export function colonyForecast(w: World, slug: string, resource: Resource): StockForecast | null {
  const ci = w.colonies.findIndex(c => c.slug === slug);
  if (ci < 0) return null;
  const c = w.colonies[ci];
  const st = c.stocks.find(s => s.resource === resource);
  if (!st) return null;
  const s = activeStorm(w);
  const e = s ? ensembleFor(w, s) : null;
  // shift the ensemble by the storm's age so arrivals stay relative to now
  let ens = e;
  if (e && s) {
    const age = stormAge(w, s);
    ens = { ...e, perRun: e.perRun.map(r => ({ ...r, arrival: r.arrival.map(a => (a === null ? null : Math.max(0, a - age))) })), impacts: e.impacts.map(i => ({ ...i, arrivalP10: i.arrivalP10 === null ? null : Math.max(0, i.arrivalP10 - age), arrivalP90: i.arrivalP90 === null ? null : Math.max(0, i.arrivalP90 - age), arrivalMedian: i.arrivalMedian === null ? null : Math.max(0, i.arrivalMedian - age) })) };
  }
  return forecastStock(st, c.power, ci, ens, colonyDeliveries(w, slug), 60);
}

// ---------- Earth resupply ----------
const winCache = new Map<number, Traj>();
export function nextWindow(w: World): Traj {
  const jd0 = Math.floor(w.simEpochJd + w.simOffsetDays);
  let t = winCache.get(jd0);
  if (!t) { t = findWindow(jd0); winCache.set(jd0, t); }
  return t;
}

/**
 * Earth order demand: each colony's structural deficit (use − make, kg/sol) must be covered
 * from this order's arrival until the following window's cargo lands (~one synodic period, 780 d),
 * plus a 15 % dust-season margin, plus spares and replacement rovers.
 */
export function orderDemand(w: World): Partial<Record<Category, number>> {
  const days = 780, margin = 1.15;
  const def = (r: Resource) => w.colonies.reduce((s, c) => { const st = c.stocks.find(x => x.resource === r); return s + (st ? Math.max(0, st.dailyUse - st.dailyMake) : 0); }, 0);
  const t = (kgPerSol: number) => Math.round((kgPerSol * days / SOL_DAYS) * margin / 1000);
  return { O2: Math.max(12, t(def('O2'))) + 18 /* O₂ generator + ECLSS spares for Arcadia */, WATER: t(def('WATER')), FOOD: t(def('FOOD')), SPARES: 40, ROVERS: 22 /* 2 × 11 t rovers replacing r-3 and r-6 */ };
}

export function buildOrderPlan(w: World) {
  const win = nextWindow(w);
  const demand = orderDemand(w);
  const packed = packCargo(itemsFromDemand(demand), ['LF-1', 'LF-2', 'LF-3']);
  const zones = scoreZones(w.zones);
  return { win, demand, ships: packed.ships, unplaced: packed.unplaced, zones };
}

export function earthDelayMs(w: World, nowMs = Date.now()) {
  const scale = Number(process.env.DEMO_DELAY_SCALE ?? process.env.NEXT_PUBLIC_DEMO_DELAY_SCALE ?? 0.1);
  return lightDelaySec(simJd(w, nowMs)) * 1000 * scale;
}
export function timeoutMs(w: World) {
  const scale = Number(process.env.DEMO_TIMEOUT_SCALE ?? 0.02);
  return w.policy.thresholds.replyTimeoutMin * 60000 * scale;
}

export const crewNeeds = (pop: number) => ({ O2: BVAD.o2KgPerPerson * pop, WATER: BVAD.waterKgPerPerson * pop, FOOD: BVAD.foodKgPerPerson * pop });

export function clock(w: World) { return clockSnapshot(w); }
export { distanceKm };
