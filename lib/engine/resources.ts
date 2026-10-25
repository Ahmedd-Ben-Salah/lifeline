/**
 * Resource model — how long each colony lasts, and how stocks evolve over the next 60 sols.
 *
 * Crew needs per person per sol (NASA BVAD, Baseline Values and Assumptions Document):
 *   O₂ 0.84 kg · drinking/food water 2.5 kg · hygiene water 4.0 kg · food 1.8 kg · water recovery 98 %.
 *
 * Power drives production. During a dust storm the solar share of power drops
 * (solarFactor(τ), calibrated on Opportunity 2018). Shortfalls are allocated by the
 * life-critical order in the charter: O₂ first, then water, then food lighting.
 */
import { solarFactor, EnsembleResult } from './storm';
import { mulberry32, quantile } from './rng';

export const BVAD = { o2KgPerPerson: 0.84, waterKgPerPerson: 6.5, foodKgPerPerson: 1.8, waterRecovery: 0.98 };

export type Resource = 'O2' | 'WATER' | 'FOOD' | 'POWER';
export interface Stock { resource: Resource; amount: number; unit: string; dailyUse: number; dailyMake: number }
export interface PowerSystem { solarKw: number; nuclearKw: number; demandKw: number; localTau: number }

export interface Thresholds { criticalDays: number; watchDays: number }

/** Reserve days = how long the colony lasts on stored stock alone if production stops. */
export const reserveDays = (s: Stock) => (s.dailyUse > 0 ? s.amount / s.dailyUse : Infinity);

export function powerAvailableKw(p: PowerSystem, tau = p.localTau) {
  return p.nuclearKw + p.solarKw * solarFactor(tau);
}
export const powerPct = (p: PowerSystem, tau = p.localTau) => Math.min(1, powerAvailableKw(p, tau) / p.demandKw);

/** Share of nominal production each resource gets at a given power fraction (O₂ protected first). */
export function productionFactor(resource: Resource, pf: number) {
  if (resource === 'O2') return Math.min(1, pf * 2.0);
  if (resource === 'WATER') return Math.min(1, pf * 1.4);
  if (resource === 'FOOD') return Math.min(1, pf);
  return pf;
}

export type Status = 'NOMINAL' | 'WATCH' | 'CRITICAL';
export function statusFromDays(days: number, t: Thresholds): Status {
  if (days < t.criticalDays) return 'CRITICAL';
  if (days < t.watchDays) return 'WATCH';
  return 'NOMINAL';
}

export interface Delivery { sol: number; resource: Resource; kg: number; label: string }

export interface StockForecast {
  resource: Resource; sols: number[];
  median: number[]; p10: number[]; p90: number[];
  noAction: number[];          // median without deliveries
  runOutSol: { withPlan: number | null; noAction: number | null }; // median run-out
  /** median over runs of the lowest stock reached without deliveries, NOT clamped at zero (negative = deficit) */
  noActionMinRaw: number;
  events: { sol: number; label: string; kind: 'storm' | 'delivery' }[];
  stormWindow: { from: number; to: number } | null;
}

/**
 * Monte-Carlo stock forecast. Each ensemble run gives this colony a storm arrival sol (or none),
 * a peak optical depth and a lifetime; the stock is integrated sol by sol.
 */
export function forecastStock(
  stock: Stock, power: PowerSystem, colonyIndex: number, ens: EnsembleResult | null,
  deliveries: Delivery[], horizon = 60,
): StockForecast {
  const pfNow = powerPct(power);
  const nominalMake = stock.dailyMake / Math.max(0.05, productionFactor(stock.resource, pfNow));
  const runs = ens ? ens.perRun : [{ arrival: [] as (number | null)[], tau: [] as number[], life: 0 }];
  const withPlan: number[][] = [], without: number[][] = [], rawMins: number[] = [];
  const rand = mulberry32(991 + colonyIndex);

  for (const run of runs) {
    const arr = run.arrival[colonyIndex] ?? null;
    const tauPeak = run.tau[colonyIndex] ?? power.localTau;
    // storm passes the colony for a fraction of its lifetime (dust lingers ~ 60 % of storm life)
    const dwell = run.life * (0.5 + 0.2 * rand());
    const a: number[] = [], b: number[] = [];
    let sA = stock.amount, sB = stock.amount, minB = stock.amount;
    for (let d = 0; d <= horizon; d++) {
      a.push(Math.max(0, sA)); b.push(Math.max(0, sB));
      let tau = power.localTau;
      if (arr !== null && d >= arr && d <= arr + dwell) {
        const ramp = Math.min(1, (d - arr) / 2); // front arrives over ~2 sols
        tau = Math.max(tau, power.localTau + (tauPeak - power.localTau) * ramp);
      }
      const make = nominalMake * productionFactor(stock.resource, powerPct(power, tau));
      const net = make - stock.dailyUse;
      const del = deliveries.filter(x => x.resource === stock.resource && Math.floor(x.sol) === d).reduce((s, x) => s + x.kg, 0);
      sA += net + del; sB += net; minB = Math.min(minB, sB);
    }
    rawMins.push(minB);
    withPlan.push(a); without.push(b);
  }

  const sols = Array.from({ length: horizon + 1 }, (_, i) => i);
  const col = (m: number[][], d: number) => m.map(r => r[d]).sort((x, y) => x - y);
  const median = sols.map(d => quantile(col(withPlan, d), 0.5));
  const p10 = sols.map(d => quantile(col(withPlan, d), 0.1));
  const p90 = sols.map(d => quantile(col(withPlan, d), 0.9));
  const noAction = sols.map(d => quantile(col(without, d), 0.5));
  const runOut = (s: number[]) => { const i = s.findIndex(v => v <= 0.5); return i < 0 ? null : i; };

  let stormWindow: StockForecast['stormWindow'] = null;
  if (ens) {
    const t = ens.impacts[colonyIndex];
    if (t && t.arrivalP10 !== null && t.probability >= 0.3) stormWindow = { from: t.arrivalP10, to: Math.min(horizon, (t.arrivalP90 ?? t.arrivalP10) + ens.durationSols.median * 0.6) };
  }
  const events: StockForecast['events'] = [];
  if (stormWindow) events.push({ sol: stormWindow.from, label: 'storm arrives (p10)', kind: 'storm' });
  deliveries.filter(x => x.resource === stock.resource).forEach(x => events.push({ sol: x.sol, label: x.label, kind: 'delivery' }));

  return { resource: stock.resource, sols, median, p10, p90, noAction, runOutSol: { withPlan: runOut(median), noAction: runOut(noAction) }, noActionMinRaw: quantile(rawMins.sort((x, y) => x - y), 0.5), events, stormWindow };
}

/** Shortfall over a window if nothing is delivered — what a colony NEEDs. */
export function shortfall(f: StockForecast, reserveKg = 0) {
  const min = Math.min(...f.noAction);
  return Math.max(0, reserveKg - min, -min);
}

/**
 * What a colony can safely give away: everything above `keepDays` of its own consumption,
 * after its own 60-sol forecast (so donors never endanger themselves).
 */
export function spareCapacity(stock: Stock, keepDays: number, forecastMin: number) {
  const keep = stock.dailyUse * keepDays;
  return Math.max(0, Math.min(stock.amount, forecastMin) - keep);
}
