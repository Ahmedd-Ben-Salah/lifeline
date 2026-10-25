/**
 * Simulation clock helpers (shared by server and browser).
 * Sim time runs at real speed from the scenario epoch; the demo can jump it forward by whole sols.
 */
import { marsSolDate, marsLs, lightDelaySec, dateFromJd, marsYear } from '@/lib/engine/ephemeris';

export const SOL_DAYS = 1.0274912517; // one Mars solar day in Earth days

export interface ClockBase { resetAtMs: number; simEpochJd: number; simOffsetDays: number; solEpochMsd: number }

export const simJd = (w: ClockBase, nowMs = Date.now()) => w.simEpochJd + w.simOffsetDays + (nowMs - w.resetAtMs) / 86400000;
/** Mission sol (sols since the network was founded). Fractional. */
export const missionSolF = (w: ClockBase, jd: number) => marsSolDate(jd) - w.solEpochMsd;
export const missionSol = (w: ClockBase, jd: number) => Math.floor(missionSolF(w, jd));

/** Local mean solar time at a Mars longitude (°E), "HH:MM". */
export function lmst(jd: number, lonE: number) {
  const msd = marsSolDate(jd);
  let h = ((msd % 1) * 24 + lonE / 15) % 24;
  if (h < 0) h += 24;
  const hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** Message timestamp label: LMST at Jezero (network HQ, 77.45°E). */
export const HQ_LON = 77.45;
export function msgTime(w: ClockBase, ms: number) {
  return lmst(simJd(w, ms), HQ_LON);
}

export function clockSnapshot(w: ClockBase, nowMs = Date.now()) {
  const jd = simJd(w, nowMs);
  return {
    jd, nowMs,
    sol: missionSol(w, jd),
    solF: missionSolF(w, jd),
    ls: marsLs(jd),
    marsYear: marsYear(jd),
    lightDelaySec: lightDelaySec(jd),
    utc: dateFromJd(jd).toISOString(),
    lmstHQ: lmst(jd, HQ_LON),
  };
}

export const fmtDelay = (sec: number) => `${Math.floor(sec / 60)}m ${String(Math.floor(sec % 60)).padStart(2, '0')}s`;
export const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US');
export const fmt1 = (n: number) => (Math.round(n * 10) / 10).toFixed(1);
