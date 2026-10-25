/**
 * Lambert's problem: "which orbit takes me from r1 to r2 in exactly t seconds?"
 * Universal-variable formulation (Curtis, Orbital Mechanics for Engineering Students, Alg. 5.2),
 * solved with bisection on z (robust, no divergence) — single revolution, prograde.
 *
 * Porkchop: for every (departure date, time of flight) pair we solve Lambert between
 * Earth at departure and Mars at arrival and compute launch energy C3 = |v∞|².
 */
import { AU_KM, GM_SUN, DAY_S, Vec3, helio, helioVel, norm, sub, toKm } from './ephemeris';

function stumpC(z: number) {
  if (z > 1e-8) return (1 - Math.cos(Math.sqrt(z))) / z;
  if (z < -1e-8) return (Math.cosh(Math.sqrt(-z)) - 1) / -z;
  return 0.5;
}
function stumpS(z: number) {
  if (z > 1e-8) { const s = Math.sqrt(z); return (s - Math.sin(s)) / (s * s * s); }
  if (z < -1e-8) { const s = Math.sqrt(-z); return (Math.sinh(s) - s) / (s * s * s); }
  return 1 / 6;
}

export interface LambertResult { v1: Vec3; v2: Vec3 }

/** r1, r2 in km, tof in seconds. Returns heliocentric velocities (km/s) or null if no solution. */
export function lambert(r1: Vec3, r2: Vec3, tof: number, mu = GM_SUN): LambertResult | null {
  const r1n = norm(r1), r2n = norm(r2);
  const cz = r1.x * r2.y - r1.y * r2.x; // z of r1 × r2 (ecliptic north)
  let cosT = (r1.x * r2.x + r1.y * r2.y + r1.z * r2.z) / (r1n * r2n);
  cosT = Math.max(-1, Math.min(1, cosT));
  let theta = Math.acos(cosT);
  if (cz < 0) theta = 2 * Math.PI - theta; // prograde transfer
  const A = Math.sin(theta) * Math.sqrt((r1n * r2n) / (1 - Math.cos(theta)));
  if (!isFinite(A) || Math.abs(A) < 1e-9) return null;

  const y = (z: number) => r1n + r2n + (A * (z * stumpS(z) - 1)) / Math.sqrt(stumpC(z));
  const F = (z: number) => {
    const yz = y(z);
    if (yz < 0) return -Infinity;
    return Math.pow(yz / stumpC(z), 1.5) * stumpS(z) + A * Math.sqrt(yz) - Math.sqrt(mu) * tof;
  };

  // F(z) increases monotonically with z for the single-revolution branch.
  let lo = -4 * Math.PI * Math.PI, hi = 4 * Math.PI * Math.PI - 1e-6;
  while (y(lo) < 0 && lo < hi) lo += 0.1; // y must stay positive
  if (F(lo) > 0 || F(hi) < 0) return null;
  let z = 0;
  for (let i = 0; i < 90; i++) {
    z = 0.5 * (lo + hi);
    if (F(z) > 0) hi = z; else lo = z;
    if (hi - lo < 1e-10) break;
  }
  const yz = y(z);
  const f = 1 - yz / r1n;
  const g = A * Math.sqrt(yz / mu);
  const gdot = 1 - yz / r2n;
  return {
    v1: { x: (r2.x - f * r1.x) / g, y: (r2.y - f * r1.y) / g, z: (r2.z - f * r1.z) / g },
    v2: { x: (gdot * r2.x - r1.x) / g, y: (gdot * r2.y - r1.y) / g, z: (gdot * r2.z - r1.z) / g },
  };
}

export interface Transfer {
  depJd: number; tofDays: number; arrJd: number;
  c3: number;            // launch energy km²/s²
  vinfDep: number;       // km/s, hyperbolic excess leaving Earth
  vinfArr: number;       // km/s, arriving at Mars
  v1?: Vec3; r1?: Vec3;  // for trajectory drawing
}

/** Solve one Earth→Mars transfer. */
export function transfer(depJd: number, tofDays: number, keepState = false): Transfer | null {
  const arrJd = depJd + tofDays;
  const r1 = toKm(helio('earth', depJd));
  const r2 = toKm(helio('mars', arrJd));
  const sol = lambert(r1, r2, tofDays * DAY_S);
  if (!sol) return null;
  const vE = helioVel('earth', depJd), vM = helioVel('mars', arrJd);
  const vinfDep = norm(sub(sol.v1, vE));
  const vinfArr = norm(sub(sol.v2, vM));
  return { depJd, tofDays, arrJd, c3: vinfDep * vinfDep, vinfDep, vinfArr, ...(keepState ? { v1: sol.v1, r1 } : {}) };
}

export interface Porkchop {
  depStartJd: number; depStepDays: number; nDep: number;
  tofStartDays: number; tofStepDays: number; nTof: number;
  /** row-major [tofIndex * nDep + depIndex], C3 in km²/s² (NaN = no solution) */
  c3: number[];
  best: Transfer;
}

/** Grid of C3 values over departure × time-of-flight. */
export function porkchop(depStartJd: number, depEndJd: number, tofMin: number, tofMax: number, nDep = 120, nTof = 72): Porkchop {
  const depStep = (depEndJd - depStartJd) / (nDep - 1);
  const tofStep = (tofMax - tofMin) / (nTof - 1);
  const c3: number[] = new Array(nDep * nTof);
  let best: Transfer | null = null;
  for (let j = 0; j < nTof; j++) {
    const tof = tofMin + j * tofStep;
    for (let i = 0; i < nDep; i++) {
      const t = transfer(depStartJd + i * depStep, tof);
      const v = t ? t.c3 : NaN;
      c3[j * nDep + i] = v;
      if (t && (!best || t.c3 < best.c3)) best = t;
    }
  }
  return { depStartJd, depStepDays: depStep, nDep, tofStartDays: tofMin, tofStepDays: tofStep, nTof, c3, best: best! };
}

/** Sample a transfer trajectory (AU, heliocentric) by propagating the Lambert departure state with a two-body integrator. */
export function trajectoryPoints(t: Transfer, n = 180): { x: number; y: number; z: number }[] {
  const full = transfer(t.depJd, t.tofDays, true);
  if (!full || !full.v1 || !full.r1) return [];
  // Universal Kepler propagation via f & g series is overkill here; use RK4 in km & s.
  const mu = GM_SUN;
  let r = { ...full.r1 }, v = { ...full.v1 };
  const total = t.tofDays * DAY_S, dt = total / (n * 8);
  const out = [{ x: r.x / AU_KM, y: r.y / AU_KM, z: r.z / AU_KM }];
  const acc = (p: Vec3): Vec3 => { const d = Math.pow(norm(p), 3); return { x: -mu * p.x / d, y: -mu * p.y / d, z: -mu * p.z / d }; };
  for (let s = 1; s <= n * 8; s++) {
    const k1v = acc(r), k1r = v;
    const r2 = { x: r.x + k1r.x * dt / 2, y: r.y + k1r.y * dt / 2, z: r.z + k1r.z * dt / 2 };
    const v2 = { x: v.x + k1v.x * dt / 2, y: v.y + k1v.y * dt / 2, z: v.z + k1v.z * dt / 2 };
    const k2v = acc(r2), k2r = v2;
    const r3 = { x: r.x + k2r.x * dt / 2, y: r.y + k2r.y * dt / 2, z: r.z + k2r.z * dt / 2 };
    const v3 = { x: v.x + k2v.x * dt / 2, y: v.y + k2v.y * dt / 2, z: v.z + k2v.z * dt / 2 };
    const k3v = acc(r3), k3r = v3;
    const r4 = { x: r.x + k3r.x * dt, y: r.y + k3r.y * dt, z: r.z + k3r.z * dt };
    const v4 = { x: v.x + k3v.x * dt, y: v.y + k3v.y * dt, z: v.z + k3v.z * dt };
    const k4v = acc(r4), k4r = v4;
    r = { x: r.x + dt / 6 * (k1r.x + 2 * k2r.x + 2 * k3r.x + k4r.x), y: r.y + dt / 6 * (k1r.y + 2 * k2r.y + 2 * k3r.y + k4r.y), z: r.z + dt / 6 * (k1r.z + 2 * k2r.z + 2 * k3r.z + k4r.z) };
    v = { x: v.x + dt / 6 * (k1v.x + 2 * k2v.x + 2 * k3v.x + k4v.x), y: v.y + dt / 6 * (k1v.y + 2 * k2v.y + 2 * k3v.y + k4v.y), z: v.z + dt / 6 * (k1v.z + 2 * k2v.z + 2 * k3v.z + k4v.z) };
    if (s % 8 === 0) out.push({ x: r.x / AU_KM, y: r.y / AU_KM, z: r.z / AU_KM });
  }
  return out;
}
