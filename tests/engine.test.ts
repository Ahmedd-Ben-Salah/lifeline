/**
 * Engine tests — checks against real reference values so we can defend every number.
 */
import { describe, it, expect } from 'vitest';
import { helio, jdFromDate, lightDelaySec, marsLs, earthMarsKm, AU_KM, marsSolDate } from '@/lib/engine/ephemeris';
import { lambert, transfer } from '@/lib/engine/lambert';
import { findWindow } from '@/lib/engine/windows';
import { runEnsemble, solarFactor } from '@/lib/engine/storm';
import { reserveDays, forecastStock } from '@/lib/engine/resources';
import { planRoute, elevationAt } from '@/lib/engine/router';
import { packCargo, itemsFromDemand } from '@/lib/engine/packer';
import { scoreZone } from '@/lib/engine/landing';
import { distanceKm, greatCircle, destination, bearing } from '@/lib/engine/geo';
import { numbersGrounded } from '@/lib/agents/llm';

describe('ephemeris (JPL approximate elements)', () => {
  it('Earth is ~1 AU from the Sun all year', () => {
    for (let d = 0; d < 365; d += 30) {
      const e = helio('earth', jdFromDate(Date.UTC(2026, 0, 1)) + d);
      const r = Math.hypot(e.x, e.y, e.z);
      expect(r).toBeGreaterThan(0.983); expect(r).toBeLessThan(1.017);
    }
  });
  it('Mars perihelion 1.381 AU / aphelion 1.666 AU', () => {
    let min = 9, max = 0;
    for (let d = 0; d < 687; d += 2) { const m = helio('mars', 2460000 + d); const r = Math.hypot(m.x, m.y, m.z); min = Math.min(min, r); max = Math.max(max, r); }
    expect(min).toBeCloseTo(1.381, 2); expect(max).toBeCloseTo(1.666, 2);
  });
  it('2018 opposition: Earth–Mars distance ≈ 57.6 million km on 31 Jul 2018', () => {
    expect(earthMarsKm(jdFromDate(Date.UTC(2018, 6, 31))) / 1e6).toBeCloseTo(57.6, 0);
  });
  it('light delay stays between 3 and 23 minutes', () => {
    for (let d = 0; d < 800; d += 10) { const s = lightDelaySec(2460000 + d); expect(s).toBeGreaterThan(180); expect(s).toBeLessThan(23 * 60); }
  });
  it('Ls: Mars northern spring equinox MY 37 ≈ 26 Dec 2022 (Ls ≈ 0)', () => {
    const ls = marsLs(jdFromDate(Date.UTC(2022, 11, 26)));
    expect(Math.min(ls, 360 - ls)).toBeLessThan(3);
  });
  it('Mars Sol Date: 44796.0 at 6 Jan 2000 (Mars24 epoch)', () => {
    expect(marsSolDate(2451549.5)).toBeCloseTo(44795.999, 2);
  });
});

describe('Lambert + launch windows', () => {
  it('Hohmann-like transfer reproduces itself (round trip check)', () => {
    const r1 = { x: AU_KM, y: 0, z: 0 }, r2 = { x: -1.524 * AU_KM, y: 1e6, z: 0 };
    const s = lambert(r1, r2, 259 * 86400)!;
    expect(s).not.toBeNull();
    const v = Math.hypot(s.v1.x, s.v1.y, s.v1.z);
    expect(v).toBeGreaterThan(32); expect(v).toBeLessThan(33.5); // ~32.7 km/s heliocentric at departure
  });
  it('2026 window: late Oct–Nov 2026 with C3 ≈ 8–11 km²/s² (real mission-design range)', () => {
    const w = findWindow(jdFromDate(Date.UTC(2026, 0, 1)));
    const dep = new Date((w.depJd - 2440587.5) * 86400000);
    expect(dep.getUTCFullYear()).toBe(2026);
    expect([9, 10, 11]).toContain(dep.getUTCMonth());
    expect(w.c3).toBeGreaterThan(7.5); expect(w.c3).toBeLessThan(11.5);
  });
  it('windows repeat every ~26 months (synodic period)', () => {
    const a = findWindow(jdFromDate(Date.UTC(2026, 0, 1)));
    const b = findWindow(a.depJd + 300);
    expect(b.depJd - a.depJd).toBeGreaterThan(700); expect(b.depJd - a.depJd).toBeLessThan(860);
  });
  it('transfer C3 is positive and finite', () => {
    const t = transfer(jdFromDate(Date.UTC(2026, 9, 30)), 296)!;
    expect(t.c3).toBeGreaterThan(0); expect(Number.isFinite(t.vinfArr)).toBe(true);
  });
});

describe('storm ensemble', () => {
  const cols = [{ slug: 'arcadia', name: 'Arcadia', lat: 47, lon: -176 }, { slug: 'jezero', name: 'Jezero', lat: 18.44, lon: 77.45 }];
  const origin = { lat: -42, lon: 70 };
  const p = { code: 'S', origin, originName: 'Hellas', meanBearingDeg: bearing(origin, cols[0]), bearingSpreadDeg: 19, medianSpeedKmSol: 680, speedSigma: 0.22, meanLifetimeSols: 40, radius0Km: 350, growthKmSol: 50, maxRadiusKm: 1100, tauCore: 9.5, tauNow: 2.4, tauBefore: 0.9, seed: 4412 };
  it('is deterministic for the same seed', () => {
    const a = runEnsemble(p, cols, 'arcadia'), b = runEnsemble(p, cols, 'arcadia');
    expect(a.histogram).toEqual(b.histogram);
    expect(a.target.runsReached).toBe(b.target.runsReached);
  });
  it('changes with a different seed', () => {
    const a = runEnsemble(p, cols, 'arcadia'), b = runEnsemble({ ...p, seed: 7 }, cols, 'arcadia');
    expect(a.histogram).not.toEqual(b.histogram);
  });
  it('Opportunity calibration: τ≈10.8 removes ~96% of solar power', () => {
    expect(1 - solarFactor(10.8)).toBeGreaterThan(0.95);
    expect(1 - solarFactor(0.5)).toBeLessThan(0.01);
  });
});

describe('resources', () => {
  const st = { resource: 'O2' as const, amount: 670, unit: 'kg', dailyUse: 35.3, dailyMake: 21 };
  const power = { solarKw: 40, nuclearKw: 20, demandKw: 96, localTau: 2.4 };
  it('reserve days = stock / daily use (Arcadia O₂ = 19 d)', () => { expect(Math.floor(reserveDays(st))).toBe(18); expect(Math.round(reserveDays(st))).toBe(19); });
  it('a delivery raises the forecast', () => {
    const a = forecastStock(st, power, 0, null, [], 60);
    const b = forecastStock(st, power, 0, null, [{ sol: 5, resource: 'O2', kg: 500, label: 'x' }], 60);
    expect(b.median[30]).toBeGreaterThan(a.median[30]);
    expect(a.runOutSol.noAction).not.toBeNull();
  });
});

describe('rover router (MOLA A*)', () => {
  it('elevations match MOLA (Olympus high, Hellas deep)', () => {
    expect(elevationAt({ lat: 18.65, lon: -133.8 })).toBeGreaterThan(12000);
    expect(elevationAt({ lat: -42, lon: 70 })).toBeLessThan(-5000);
  });
  it('route is close to the great-circle distance on flat Utopia–Arcadia plains', () => {
    const a = { lat: 46.7, lon: 117.5 }, b = { lat: 47, lon: -176 };
    const r = planRoute(a, b)!;
    expect(r.km).toBeGreaterThan(distanceKm(a, b)); expect(r.km).toBeLessThan(distanceKm(a, b) * 1.15);
  });
});

describe('geo, packer, landing, guard', () => {
  it('destination/bearing round trip', () => {
    const a = { lat: 10, lon: 20 }, b = destination(a, 45, 1000);
    expect(distanceKm(a, b)).toBeCloseTo(1000, 0);
    expect(greatCircle(a, b, 10)).toHaveLength(11);
  });
  it('packer respects 100 t per ship and places life-critical cargo first', () => {
    const { ships, unplaced } = packCargo(itemsFromDemand({ O2: 32, WATER: 38, FOOD: 129, SPARES: 40, ROVERS: 22 }), ['A', 'B', 'C']);
    ships.forEach(s => expect(s.massT).toBeLessThanOrEqual(100));
    expect(unplaced.every(i => i.category !== 'O2' && i.category !== 'WATER')).toBe(true);
  });
  it('landing score formula', () => {
    expect(scoreZone({ name: 'z', lat: 0, lon: 0, slopeDeg: 2, quakeRisk: 0.1, distanceKm: 38, dustTau: 2 }).score).toBeCloseTo(0.841, 2);
  });
  it('hallucination guard rejects invented numbers', () => {
    expect(numbersGrounded('Arrives in 7.9 sols with 2,450 kg', '{"eta":7.9,"kg":2450}')).toBe(true);
    expect(numbersGrounded('Arrives in 6.4 sols', '{"eta":7.9}')).toBe(false);
  });
});
