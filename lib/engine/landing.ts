/**
 * Landing zone scorer.
 * score = 0.35·(1 − slope/10°) + 0.25·(1 − quakeRisk) + 0.25·(1 − distance/2500 km) + 0.15·(1 − dustτ/5), clamped 0..1
 */
export interface Zone { name: string; lat: number; lon: number; slopeDeg: number; quakeRisk: number; distanceKm: number; dustTau: number }
const clamp = (v: number) => Math.max(0, Math.min(1, v));
export function scoreZone(z: Zone) {
  const parts = {
    slope: 0.35 * clamp(1 - z.slopeDeg / 10),
    quake: 0.25 * clamp(1 - z.quakeRisk),
    distance: 0.25 * clamp(1 - z.distanceKm / 2500),
    dust: 0.15 * clamp(1 - z.dustTau / 5),
  };
  return { ...z, score: clamp(parts.slope + parts.quake + parts.distance + parts.dust), parts };
}
export const scoreZones = (zones: Zone[]) => zones.map(scoreZone).sort((a, b) => b.score - a.score);
