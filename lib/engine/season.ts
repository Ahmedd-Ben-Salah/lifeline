/**
 * Watch and Outlook horizons.
 *
 * OUTLOOK (~18 months) — climatology. Mars Climate Sounder / TES records for Mars Years 24–37
 * (Kass et al. 2016; Montabone et al. 2015) show three regional-storm seasons every year:
 *   A storms ~Ls 210–240, B storms ~Ls 250–310 (south, around perihelion), C storms ~Ls 310–340.
 * Planet-encircling (global) events: MY 25 (2001), MY 28 (2007), MY 34 (2018) → 3 of 14 years ≈ 21 %.
 * We model the regional-storm activity as a sum of three seasonal bumps and scale it by latitude.
 *
 * WATCH (weeks) — a disturbance that is getting dustier may grow into a regional storm.
 * Heuristic logistic model on τ trend, area and season (documented coefficients, not a fitted model).
 */
export const GLOBAL_STORM_YEARS = { observed: 3, of: 14, rate: 3 / 14 };

const bump = (ls: number, mu: number, sigma: number) => {
  let d = Math.abs(ls - mu); if (d > 180) d = 360 - d;
  return Math.exp(-0.5 * (d / sigma) ** 2);
};

/** Relative regional-storm activity 0..1 at season Ls. */
export function seasonActivity(ls: number) {
  const v = 0.55 * bump(ls, 225, 14) + 1.0 * bump(ls, 275, 22) + 0.5 * bump(ls, 325, 10);
  return Math.min(1, v);
}

/** Latitude weighting: southern mid-latitudes and the tropics see most storm activity, high north least. */
export function latitudeWeight(lat: number) {
  if (lat < -20) return 1.0;
  if (lat < 25) return 0.85;
  if (lat < 40) return 0.6;
  return 0.5;
}

/** Probability that a colony sees a significant regional storm (τ > 2) during the coming dust season. */
export function seasonRisk(lat: number) {
  // integrate activity over the season and map to a probability (calibrated so the busiest latitude ≈ 0.7)
  let s = 0;
  for (let ls = 160; ls <= 340; ls += 2) s += seasonActivity(ls);
  const intensity = s / 45;
  return Math.min(0.95, 1 - Math.exp(-intensity * latitudeWeight(lat) * 1.6));
}

/** Watch: probability a disturbance grows into a regional storm within ~2 weeks. */
export function watchProbability(tauTrendPerSol: number, areaKm2: number, ls: number) {
  const z = -2.2 + 9 * tauTrendPerSol + 0.9 * Math.log10(areaKm2 / 1e5) + 1.6 * seasonActivity(ls);
  return 1 / (1 + Math.exp(-z));
}
