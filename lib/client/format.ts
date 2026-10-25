export const int = (n: number | null | undefined) => (n === null || n === undefined || !isFinite(n) ? '—' : Math.round(n).toLocaleString('en-US'));
export const f1 = (n: number | null | undefined) => (n === null || n === undefined || !isFinite(n) ? '—' : (Math.round(n * 10) / 10).toFixed(1));
export const f2 = (n: number | null | undefined) => (n === null || n === undefined || !isFinite(n) ? '—' : n.toFixed(2));
export const pct = (x: number | null | undefined) => (x === null || x === undefined ? '—' : `${Math.round(x * 100)}%`);
export const delay = (sec: number) => `${Math.floor(sec / 60)}m ${String(Math.floor(sec % 60)).padStart(2, '0')}s`;
export const mmss = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
export const date = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
export const RES_LABEL: Record<string, string> = { O2: 'Air', WATER: 'Water', FOOD: 'Food', POWER: 'Power' };
export const RES_SHORT: Record<string, string> = { O2: 'air', WATER: 'water', FOOD: 'food', POWER: 'power' };
export const statusChip = (s: string) => (s === 'CRITICAL' ? 'crit' : s === 'WATCH' ? 'warn' : 'ok');
export const statusWord = (s: string) => (s === 'CRITICAL' ? 'Urgent' : s === 'WATCH' ? 'Watch' : 'OK');

/** Dust level words for optical depth τ. */
export function dustLevel(tau: number | null | undefined) {
  if (tau === null || tau === undefined || !isFinite(tau)) return '—';
  return tau < 1 ? 'low' : tau < 2.5 ? 'medium' : tau < 5 ? 'high' : 'extreme';
}
/** 0.78 → "78% chance" */
export const chance = (p: number | null | undefined) => (p === null || p === undefined ? '—' : `${Math.round(p * 100)}% chance`);
/** Slope words for a grade in degrees. */
export const slopeWord = (deg: number | null | undefined) => (deg === null || deg === undefined ? '—' : deg < 2 ? 'flat' : deg < 6 ? 'gentle' : 'steep');
/** 19.2 → "19 days left" */
export const daysLeft = (d: number | null | undefined) => (d === null || d === undefined || !isFinite(d) ? '—' : `${Math.round(d)} day${Math.round(d) === 1 ? '' : 's'} left`);
/** Seconds of light delay → "6 min" */
export const minutes = (sec: number) => `${Math.max(1, Math.round(sec / 60))} min`;
/** Fuel words for launch energy C3 (km²/s²). */
export const fuelWord = (c3: number | null | undefined) => (c3 === null || c3 === undefined ? '—' : c3 < 10 ? 'low' : c3 < 16 ? 'medium' : 'high');
/** Landing score words. */
export const landingWord = (score: number) => (score >= 0.8 ? 'Best' : score >= 0.6 ? 'Good' : 'Risky');
