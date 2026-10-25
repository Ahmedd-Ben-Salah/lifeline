/**
 * Storm ensemble — a hurricane-style forecast for a Martian dust storm.
 *
 * We run N (=300) perturbed copies of the storm. Each run draws:
 *   - drift bearing   mean ± 18° (normal)          — uncertainty in the regional wind field
 *   - drift speed     lognormal around the median — km per sol
 *   - lifetime        lognormal around the mean   — sols before the storm decays
 *   - growth rate     how fast the dust-lifting front widens (km/sol)
 * and advects the storm centre along a great circle in 6-hour steps (0.25 sol).
 * A colony is "reached" when it falls inside the dusty radius of the storm.
 *
 * Outputs are pure functions of (storm parameters, seed): same seed → same forecast.
 */
import { LatLon, bearing, destination, distanceKm } from './geo';
import { mulberry32, gauss, quantile } from './rng';

export interface StormParams {
  code: string;
  origin: LatLon;
  originName: string;
  meanBearingDeg: number;   // drift direction from the wind analysis
  bearingSpreadDeg: number; // 1σ
  medianSpeedKmSol: number;
  speedSigma: number;       // lognormal σ
  meanLifetimeSols: number;
  radius0Km: number;        // dusty radius today
  growthKmSol: number;      // radius growth per sol
  maxRadiusKm: number;
  tauCore: number;          // optical depth at the storm core
  tauNow: number;           // observed τ at origin
  tauBefore: number;        // τ 3 sols ago
  seed: number;
}

export interface ColonyTarget { slug: string; name: string; lat: number; lon: number }

export interface ColonyImpact {
  slug: string; name: string;
  probability: number; runsReached: number;
  arrivalP10: number | null; arrivalMedian: number | null; arrivalP90: number | null;
  tauP10: number | null; tauP90: number | null;
}

export interface ConeStep { sol: number; centre: LatLon; l67: LatLon; r67: LatLon; l90: LatLon; r90: LatLon }

export interface EnsembleResult {
  code: string; seed: number; runs: number;
  impacts: ColonyImpact[];
  target: ColonyImpact;
  histogram: { sol: number; runs: number }[];   // arrival at target (whole sols)
  cone: ConeStep[];
  sampleTracks: LatLon[][];                      // a few spaghetti tracks for display
  durationSols: { p10: number; median: number; p90: number };
  evidence: { kind: string; text: string; value?: string }[];
  /** per run: arrival sol (null = missed) and τ for every colony, plus storm lifetime. Used by the resource model. */
  perRun: { arrival: (number | null)[]; tau: number[]; life: number }[];
}

const STEP = 0.25; // sol (6 h)
const HORIZON = 20; // sols — the Track horizon

export function runEnsemble(p: StormParams, colonies: ColonyTarget[], targetSlug: string, runs = 300): EnsembleResult {
  const rand = mulberry32(p.seed);
  const reachSol: (number | null)[][] = colonies.map(() => []);
  const reachTau: number[][] = colonies.map(() => []);
  const bearings: number[] = [];
  const speeds: number[] = [];
  const lifetimes: number[] = [];
  const sampleTracks: LatLon[][] = [];
  const perRun: EnsembleResult['perRun'] = [];

  for (let r = 0; r < runs; r++) {
    const brg = p.meanBearingDeg + gauss(rand) * p.bearingSpreadDeg;
    const speed = p.medianSpeedKmSol * Math.exp(p.speedSigma * gauss(rand));
    const life = p.meanLifetimeSols * Math.exp(0.3 * gauss(rand));
    const growth = p.growthKmSol * Math.exp(0.2 * gauss(rand));
    bearings.push(brg); speeds.push(speed); lifetimes.push(life);
    const hit: (number | null)[] = colonies.map(() => null);
    const hitTau: number[] = colonies.map(() => 0);
    const track: LatLon[] = [];
    for (let t = 0; t <= HORIZON; t += STEP) {
      if (t > life) break;
      const c = destination(p.origin, brg, speed * t);
      if (r < 24 && Math.abs(t - Math.round(t)) < 1e-9) track.push(c);
      const radius = Math.min(p.maxRadiusKm, p.radius0Km + growth * t);
      colonies.forEach((col, i) => {
        if (hit[i] !== null) return;
        const d = distanceKm(c, col);
        if (d <= radius) {
          hit[i] = t;
          // optical depth at the colony: core τ fading toward the storm edge, and with age
          const age = Math.max(0.35, 1 - t / (life * 1.6));
          hitTau[i] = 1 + (p.tauCore - 1) * Math.exp(-((d / radius) ** 2) * 0.9) * age;
        }
      });
    }
    if (r < 24) sampleTracks.push(track);
    perRun.push({ arrival: hit, tau: hitTau, life });
    colonies.forEach((_, i) => { reachSol[i].push(hit[i]); if (hit[i] !== null) reachTau[i].push(hitTau[i]); });
  }

  const impacts: ColonyImpact[] = colonies.map((col, i) => {
    const sols = reachSol[i].filter((x): x is number => x !== null).sort((a, b) => a - b);
    const taus = reachTau[i].slice().sort((a, b) => a - b);
    return {
      slug: col.slug, name: col.name,
      probability: sols.length / runs, runsReached: sols.length,
      arrivalP10: sols.length ? quantile(sols, 0.1) : null,
      arrivalMedian: sols.length ? quantile(sols, 0.5) : null,
      arrivalP90: sols.length ? quantile(sols, 0.9) : null,
      tauP10: taus.length ? quantile(taus, 0.1) : null,
      tauP90: taus.length ? quantile(taus, 0.9) : null,
    };
  });
  const ti = colonies.findIndex(c => c.slug === targetSlug);
  const target = impacts[ti];

  const histMap = new Map<number, number>();
  reachSol[ti].forEach(s => { if (s !== null) { const k = Math.round(s); histMap.set(k, (histMap.get(k) || 0) + 1); } });
  const keys = [...histMap.keys()].sort((a, b) => a - b);
  const histogram: { sol: number; runs: number }[] = [];
  if (keys.length) for (let s = keys[0]; s <= keys[keys.length - 1]; s++) histogram.push({ sol: s, runs: histMap.get(s) || 0 });

  // Cone: bearing quantiles at the median speed, one step per sol
  const bs = bearings.slice().sort((a, b) => a - b);
  const sp = speeds.slice().sort((a, b) => a - b);
  const vMed = quantile(sp, 0.5);
  const b = { l90: quantile(bs, 0.05), l67: quantile(bs, 0.165), m: quantile(bs, 0.5), r67: quantile(bs, 0.835), r90: quantile(bs, 0.95) };
  const coneEnd = Math.ceil((target.arrivalP90 ?? 14) + 1);
  const cone: ConeStep[] = [];
  for (let s = 0; s <= coneEnd; s++) {
    const d = vMed * s;
    cone.push({ sol: s, centre: destination(p.origin, b.m, d), l67: destination(p.origin, b.l67, d), r67: destination(p.origin, b.r67, d), l90: destination(p.origin, b.l90, d), r90: destination(p.origin, b.r90, d) });
  }

  const lt = lifetimes.slice().sort((a, b) => a - b);
  const evidence = [
    { kind: 'sensor', text: `Dust opacity at ${p.originName} rose from τ ${p.tauBefore.toFixed(1)} to ${p.tauNow.toFixed(1)} in 3 sols across 2 colony sensors.`, value: `τ ${p.tauBefore.toFixed(1)} → ${p.tauNow.toFixed(1)}` },
    { kind: 'season', text: 'SEASON_PLACEHOLDER' },
    { kind: 'ensemble', text: `${target.runsReached} of ${runs} ensemble runs carry the storm over ${target.name}.`, value: `${target.runsReached}/${runs}` },
  ];

  return {
    code: p.code, seed: p.seed, runs, impacts, target, histogram, cone, sampleTracks,
    durationSols: { p10: quantile(lt, 0.1), median: quantile(lt, 0.5), p90: quantile(lt, 0.9) },
    evidence, perRun,
  };
}

/** Mean drift bearing helper used when seeding a scenario from the regional wind analysis. */
export const bearingTo = (a: LatLon, b: LatLon) => bearing(a, b);

/**
 * Solar power loss from dust optical depth τ.
 * Calibrated on Opportunity, June 2018: τ ≈ 10.8 → daily energy fell from ~645 Wh to ~22 Wh (−97%).
 * Beer–Lambert on the direct beam with a diffuse-light term: P/P0 = 0.92·e^(−τ/cos z) + 0.08·e^(−0.45τ)... simplified to
 * an effective P/P0 = exp(−k·τ) with k = ln(645/22)/10.8 ≈ 0.313.
 */
export const solarFactor = (tau: number) => Math.exp(-0.313 * Math.max(0, tau - 0.5));
export const solarLossPct = (tau: number) => 1 - solarFactor(tau);
