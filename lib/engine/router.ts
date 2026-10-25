/**
 * Rover router — A* search on a 1°×1° grid of real Mars elevation (MOLA).
 *
 * Edge cost = distance × (1 + slope penalty) + storm-cone penalty + blocked-zone penalty.
 *   slope penalty  grows quickly above 6° of grade (cargo rovers stay below ~12°)
 *   storm penalty  cells inside the forecast cone at the time the rover would be there
 *   blocked zones  e.g. around a broken-down rover we must not depend on
 * Speed: 20 km/h, 18 h driving per sol (autonomous convoy, nuclear + battery) → 360 km/sol.
 */
import { MOLA_B64, MOLA_MAX, MOLA_MIN, MOLA_W, MOLA_H } from './data/mola';
import { LatLon, distanceKm, pathKm, wrapLon } from './geo';

export const ROVER_KMH = 20;
export const DRIVE_HOURS_PER_SOL = 18;
export const KM_PER_SOL = ROVER_KMH * DRIVE_HOURS_PER_SOL;
const D = Math.PI / 180;

let ELEV: Float32Array | null = null;
function elevGrid(): Float32Array {
  if (ELEV) return ELEV;
  const bin = typeof Buffer !== 'undefined' ? Buffer.from(MOLA_B64, 'base64') : Uint8Array.from(atob(MOLA_B64), c => c.charCodeAt(0));
  const out = new Float32Array(MOLA_W * MOLA_H);
  for (let i = 0; i < out.length; i++) out[i] = MOLA_MIN + ((bin[2 * i] | (bin[2 * i + 1] << 8)) / 65535) * (MOLA_MAX - MOLA_MIN);
  ELEV = out;
  return out;
}

const cellOf = (p: LatLon) => ({ r: Math.min(MOLA_H - 1, Math.max(0, Math.floor(90 - p.lat))), c: ((Math.floor(wrapLon(p.lon) + 180) % 360) + 360) % 360 });
const centreOf = (r: number, c: number): LatLon => ({ lat: 89.5 - r, lon: c - 179.5 });

/** Elevation in metres (bilinear on the 1° grid). */
export function elevationAt(p: LatLon): number {
  const g = elevGrid();
  const y = Math.min(MOLA_H - 1.001, Math.max(0, 89.5 - p.lat));
  const x = (((wrapLon(p.lon) + 179.5) % 360) + 360) % 360;
  const r0 = Math.floor(y), c0 = Math.floor(x) % 360, c1 = (c0 + 1) % 360, fy = y - r0, fx = x - Math.floor(x);
  const r1 = Math.min(MOLA_H - 1, r0 + 1);
  const v = (r: number, c: number) => g[r * MOLA_W + c];
  return (v(r0, c0) * (1 - fx) + v(r0, c1) * fx) * (1 - fy) + (v(r1, c0) * (1 - fx) + v(r1, c1) * fx) * fy;
}

export interface Avoid {
  /** storm cone as polygon (lat/lon ring) active from sol `from` to `to`, penalty weight */
  cones?: { ring: LatLon[]; fromSol: number; toSol: number; weight: number }[];
  /** circles to avoid, e.g. around a failed rover */
  blocked?: { centre: LatLon; radiusKm: number; label: string }[];
  /** start time offset (sol) — when the rover leaves */
  departSol?: number;
}

export interface RoutePlan {
  path: LatLon[]; km: number; etaSols: number; maxGradeDeg: number;
  climbM: number; descentM: number;
  profile: { km: number; elevM: number }[];
  coneExposureKm: number;
}

function pointInRing(p: LatLon, ring: LatLon[]) {
  // ray casting in lon/lat (rings are small enough that wrap is handled by unwrapping around the point)
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = unwrap(ring[i].lon, p.lon), yi = ring[i].lat, xj = unwrap(ring[j].lon, p.lon), yj = ring[j].lat;
    if ((yi > p.lat) !== (yj > p.lat) && p.lon < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const unwrap = (lon: number, ref: number) => ref + wrapLon(lon - ref);

/** A* from a to b. Returns null if unreachable. */
export function planRoute(a: LatLon, b: LatLon, avoid: Avoid = {}): RoutePlan | null {
  const g = elevGrid();
  const start = cellOf(a), goal = cellOf(b);
  const N = MOLA_W * MOLA_H;
  const gScore = new Float64Array(N).fill(Infinity);
  const came = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const id = (r: number, c: number) => r * MOLA_W + c;
  const s = id(start.r, start.c), t = id(goal.r, goal.c);
  gScore[s] = 0;
  // binary heap of [f, idx]
  const heapF: number[] = [], heapI: number[] = [];
  const push = (f: number, i: number) => { heapF.push(f); heapI.push(i); let k = heapF.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heapF[p] <= heapF[k]) break; [heapF[p], heapF[k]] = [heapF[k], heapF[p]]; [heapI[p], heapI[k]] = [heapI[k], heapI[p]]; k = p; } };
  const pop = () => { const top = heapI[0]; const lf = heapF.pop()!, li = heapI.pop()!; if (heapF.length) { heapF[0] = lf; heapI[0] = li; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heapF.length && heapF[l] < heapF[m]) m = l; if (r < heapF.length && heapF[r] < heapF[m]) m = r; if (m === k) break; [heapF[m], heapF[k]] = [heapF[k], heapF[m]]; [heapI[m], heapI[k]] = [heapI[k], heapI[m]]; k = m; } } return top; };
  const goalP = centreOf(goal.r, goal.c);
  push(distanceKm(centreOf(start.r, start.c), goalP), s);
  const depart = avoid.departSol ?? 0;

  while (heapF.length) {
    const cur = pop();
    if (cur === t) break;
    if (closed[cur]) continue;
    closed[cur] = 1;
    const r = Math.floor(cur / MOLA_W), c = cur % MOLA_W;
    const P = centreOf(r, c);
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const nr = r + dr; if (nr < 0 || nr >= MOLA_H) continue;
      const nc = (c + dc + MOLA_W) % MOLA_W;
      const ni = id(nr, nc);
      if (closed[ni]) continue;
      const Q = centreOf(nr, nc);
      const dKm = distanceKm(P, Q);
      const grade = Math.atan(Math.abs(g[ni] - g[cur]) / (dKm * 1000)) / D;
      let cost = dKm * (1 + Math.max(0, grade - 1.5) * 0.6 + (grade > 6 ? (grade - 6) * 4 : 0));
      const solAt = depart + (gScore[cur] + dKm) / KM_PER_SOL; // approx. time the rover is here
      for (const cn of avoid.cones || []) if (solAt >= cn.fromSol - 1 && solAt <= cn.toSol + 1 && pointInRing(Q, cn.ring)) cost += dKm * cn.weight;
      for (const bl of avoid.blocked || []) if (distanceKm(Q, bl.centre) < bl.radiusKm) cost += dKm * 6;
      const tentative = gScore[cur] + cost;
      if (tentative < gScore[ni]) { gScore[ni] = tentative; came[ni] = cur; push(tentative + distanceKm(Q, goalP), ni); }
    }
  }
  if (came[t] < 0 && s !== t) return null;
  const cells: LatLon[] = [];
  for (let k = t; k >= 0; k = came[k]) { cells.push(centreOf(Math.floor(k / MOLA_W), k % MOLA_W)); if (k === s) break; }
  cells.reverse();
  const raw = [a, ...cells.slice(1, -1), b];
  const path = smooth(raw);
  return describe(path, avoid);
}

/** Chaikin smoothing — turns the grid staircase into a drivable line. */
function smooth(pts: LatLon[], iters = 2): LatLon[] {
  let p = pts.map(q => ({ ...q }));
  for (let k = 0; k < iters; k++) {
    if (p.length < 3) break;
    const out: LatLon[] = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const A = p[i], B = { lat: p[i + 1].lat, lon: unwrap(p[i + 1].lon, p[i].lon) };
      out.push({ lat: 0.75 * A.lat + 0.25 * B.lat, lon: wrapLon(0.75 * A.lon + 0.25 * B.lon) });
      out.push({ lat: 0.25 * A.lat + 0.75 * B.lat, lon: wrapLon(0.25 * A.lon + 0.75 * B.lon) });
    }
    out.push(p[p.length - 1]);
    p = out;
  }
  return p;
}

/** Distance, ETA, grades, elevation profile and storm exposure of an existing path. */
export function describe(path: LatLon[], avoid: Avoid = {}): RoutePlan {
  const km = pathKm(path);
  let maxGrade = 0, climb = 0, descent = 0, acc = 0, exposure = 0;
  const profile: { km: number; elevM: number }[] = [{ km: 0, elevM: elevationAt(path[0]) }];
  for (let i = 1; i < path.length; i++) {
    const d = distanceKm(path[i - 1], path[i]);
    const e0 = elevationAt(path[i - 1]), e1 = elevationAt(path[i]);
    if (d > 0.01) maxGrade = Math.max(maxGrade, Math.atan(Math.abs(e1 - e0) / (d * 1000)) / D);
    if (e1 > e0) climb += e1 - e0; else descent += e0 - e1;
    acc += d;
    profile.push({ km: acc, elevM: e1 });
    const solAt = (avoid.departSol ?? 0) + acc / KM_PER_SOL;
    for (const cn of avoid.cones || []) if (solAt >= cn.fromSol && solAt <= cn.toSol && pointInRing(path[i], cn.ring)) exposure += d;
  }
  return { path, km, etaSols: km / KM_PER_SOL, maxGradeDeg: maxGrade, climbM: climb, descentM: descent, profile, coneExposureKm: exposure };
}

/** Position along a path at a fraction 0..1 of its length. */
export function alongPath(path: LatLon[], f: number): LatLon {
  const total = pathKm(path), target = Math.max(0, Math.min(1, f)) * total;
  let acc = 0;
  for (let i = 1; i < path.length; i++) {
    const d = distanceKm(path[i - 1], path[i]);
    if (acc + d >= target) {
      const t = d > 0 ? (target - acc) / d : 0, A = path[i - 1], B = path[i];
      return { lat: A.lat + (B.lat - A.lat) * t, lon: wrapLon(A.lon + wrapLon(B.lon - A.lon) * t) };
    }
    acc += d;
  }
  return path[path.length - 1];
}
